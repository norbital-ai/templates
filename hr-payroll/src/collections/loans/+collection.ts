import { Effect } from 'effect';
import {
	defineCollection,
	refuse,
	type CollectionPatchPayload,
	type CollectionPayload
} from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import { decodeNumber } from '@norbital-ai/std/json';
import model from './+model.js';
import { boundToContract } from '../../lib/employment-contract.js';
import { loanScheduleRefusals } from '../../lib/loan-schedule.js';
import { capSubjects } from '../../lib/component_entry_cap_subject.js';
import { isEligible } from '../payroll_runs/lib/eligibility.js';
import { readRange } from '../payroll_runs/lib/effective.js';
import { dateKey } from '../../lib/iso-day.js';

const columns = {
	employment_id: true,
	loan_catalogue_id: true,
	principal: true,
	effective_range: true,
	reference: true
} as const;

/** One repayment line as the form and a caller submit it; the agreement fills its employment. */
const line = { columns: { due_date: true, amount_due: true, sequence: true } } as const;

type Repayment = {
	readonly id?: string;
	readonly due_date?: unknown;
	readonly amount_due?: unknown;
	readonly sequence?: unknown;
	readonly payslip_id?: string | null;
};
type LoanPayload =
	CollectionPayload<WorkspaceSchema, 'loans'> | CollectionPatchPayload<WorkspaceSchema, 'loans'>;
type ScheduleActions = {
	readonly create?: ReadonlyArray<Repayment>;
	readonly update?: ReadonlyArray<{ readonly id: string; readonly set: Repayment }>;
	readonly delete?: ReadonlyArray<{ readonly id: string }>;
};

/** PostgreSQL JSON uses the session zone; Date compares instants, and the fraction retains subms precision. */
const sameInstant = (left: unknown, right: unknown) => {
	if (left === right) return true;
	if (
		typeof left !== 'string' ||
		typeof right !== 'string' ||
		Date.parse(left) !== Date.parse(right)
	)
		return false;
	const fraction = (value: string) => value.match(/\.(\d+)/)?.[1]?.replace(/0+$/, '') ?? '';
	return fraction(left) === fraction(right);
};

const CAPTURED =
	'This repayment was settled by a payroll and cannot be changed. Delete the draft payroll holding it before changing its schedule.';

/** One repayment's own rules: a positive amount, a positive whole sequence, a due day. */
function assertRepayment(row: Repayment): void {
	if (!(decodeNumber(row.amount_due) > 0))
		refuse(
			"A repayment amount due is a positive magnitude; part-recovery is the engine's business, never a smaller row."
		);
	const sequence = decodeNumber(row.sequence);
	if (!Number.isInteger(sequence) || sequence < 1)
		refuse('A repayment sequence is a positive whole number.');
	if (!dateKey(row.due_date as string | null | undefined))
		refuse('A repayment must state the day it comes due.');
}

/**
 * The loan agreement and its repayment schedule, one submission (RFC §4.2).
 *
 * The form edits the whole matrix, so the update input accepts create, update and delete on the
 * schedule; the engine deletes nothing by omission. The seal that keeps a captured repayment from
 * being deleted or changed is the refusal below; a direct delete of one is refused by the
 * repayments' own delete grant. Every recovery is a payroll deduction (`lib/payroll/loan.ts`).
 */
export default defineCollection({
	model,
	create: { input: { columns, with: { repayment_loan: { create: line } } } },
	update: {
		input: { columns, with: { repayment_loan: { create: line, update: line, delete: {} } } }
	},
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const loanIds = existing.flatMap((row) => (row == null ? [] : [row.id]));
			const catalogueIds = [
				...new Set(
					inputs.flatMap((input, index) => {
						const id = input.loan_catalogue_id ?? existing[index]?.loan_catalogue_id;
						return id == null ? [] : [String(id)];
					})
				)
			];
			const employmentIds = inputs.flatMap((input, index) => {
				const id = input.employment_id ?? existing[index]?.employment_id;
				return id == null ? [] : [String(id)];
			});
			// One wave: the stored schedules, the catalogue rows and the people the batch names.
			const [stored, catalogues, subjectOf] = yield* Effect.all(
				[
					loanIds.length === 0
						? Effect.succeed([])
						: db.loan_repayments.findMany({
								where: { loan_id: { in: loanIds } },
								columns: {
									id: true,
									loan_id: true,
									due_date: true,
									amount_due: true,
									sequence: true,
									payslip_id: true
								},
								limit: 10_000
							}),
					catalogueIds.length === 0
						? Effect.succeed([])
						: db.loan_catalogue.findMany({
								where: { id: { in: catalogueIds } },
								columns: { id: true, code: true, eligibility: true },
								limit: catalogueIds.length
							}),
					capSubjects(db, employmentIds)
				],
				{ concurrency: 'unbounded' }
			);
			const catalogueById = new Map(catalogues.map((row) => [row.id, row]));
			return inputs.map((input, index) => {
				const held = existing[index];
				const bound = boundToContract(input, held);
				const employmentId = String(bound.employment_id ?? held?.employment_id);
				const principal = decodeNumber(input.principal ?? held?.principal ?? 0);
				if (!(principal > 0)) refuse('A loan principal is a positive magnitude.');
				const actions = (input.repayment_loan ?? {}) as ScheduleActions;
				const creates = actions.create ?? [];
				const updates = actions.update ?? [];
				const deletes = actions.delete ?? [];
				const schedule = new Map<string, Repayment>(
					stored.filter((row) => row.loan_id === held?.id).map((row) => [row.id, row])
				);
				for (const { id } of deletes) {
					const row = schedule.get(id);
					if (row == null) refuse('A repayment being removed is not part of this loan.');
					if (row.payslip_id != null)
						refuse(
							'This repayment was settled by a payroll and cannot be deleted. Delete the draft payroll holding it before changing its schedule.'
						);
					schedule.delete(id);
				}
				for (const { id, set } of updates) {
					const row = schedule.get(id);
					if (row == null) refuse('A repayment being changed is not part of this loan.');
					const next = { ...row, ...set };
					assertRepayment(next);
					const changed =
						decodeNumber(next.amount_due) !== decodeNumber(row.amount_due) ||
						decodeNumber(next.sequence) !== decodeNumber(row.sequence) ||
						!sameInstant(next.due_date, row.due_date);
					if (changed && row.payslip_id != null) refuse(CAPTURED);
					schedule.set(id, next);
				}
				for (const [position, row] of creates.entries()) {
					assertRepayment(row);
					schedule.set(`new:${position}`, row);
				}
				if (held == null && creates.length === 0)
					refuse('Create the loan together with its complete repayment schedule.');
				if (schedule.size === 0)
					refuse('A loan repayment schedule cannot be empty. Delete an unused agreement instead.');
				const refusals = loanScheduleRefusals({
					principal,
					effectiveRange: input.effective_range ?? held?.effective_range,
					rows: [...schedule.values()]
				});
				if (refusals.length) refuse(refusals.map((one) => one.message).join(' '));
				const catalogue = catalogueById.get(
					String(input.loan_catalogue_id ?? held?.loan_catalogue_id)
				);
				if (!catalogue) refuse('A loan must reference a loan catalogue entry.');
				// The form offers only the lines whose rule holds for the person; the transform holds
				// the same rule on the day the agreement opens, for a write that bypassed the form.
				const opens = readRange(input.effective_range ?? held?.effective_range)?.start;
				const person = subjectOf(employmentId, opens == null ? '' : dateKey(opens));
				if (person == null) refuse('A loan names an employment contract on file.');
				if (
					(catalogue.eligibility ?? '').trim() !== '' &&
					opens != null &&
					!isEligible(catalogue.eligibility, person.subject)
				)
					refuse(
						`${catalogue.code} is not offered to ${person.label}: its eligibility rule does not hold for them.`
					);
				// Every repayment rides its agreement's employment contract.
				const payload = {
					...bound,
					...(input.repayment_loan == null
						? {}
						: {
								repayment_loan: {
									...actions,
									...(creates.length === 0
										? {}
										: { create: creates.map((row) => ({ ...row, employment_id: employmentId })) })
								}
							})
				};
				return payload as LoanPayload;
			});
		})
});
