import { collection } from '@norbital-ai/bolt';
import { decodeNumber } from '../../../lib/wire.js';
import { boundToContract } from '../../../lib/employment-contract.js';
import { loanScheduleRefusals } from '../../../lib/loan-schedule.js';
import { capSubjects } from '../../../lib/component_entry_cap_subject.js';
import { readAll } from '../../../lib/reads.js';
import { plain } from '../../../lib/wire.js';
import { dateKey } from '../../../lib/iso-day.js';
import { isEligible } from '../../../lib/payroll/run/eligibility.js';
import { readRange } from '../../../lib/payroll/run/effective.js';

/**
 * The loan agreement and its repayment schedule, one submission (§3.3.4): the form edits the whole matrix, so the
 * update accepts create, update and delete on the schedule, and nothing is deleted by omission. The schedule is
 * judged whole here. A repayment a payslip settled is money history: it cannot be changed or removed until the
 * draft payroll holding it is deleted. Every recovery is a payroll deduction (`lib/payroll/loan.ts`).
 */
const c = collection('loans', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employment_id',
				'loan_catalogue_id',
				'principal',
				'effective_range',
				'reference',
				'approval_reference',
				'disbursed_on'
			],
			with: { loan_repayments: { create: { columns: ['due_date', 'amount_due', 'sequence'] } } }
		}
	},
	update: {
		input: {
			columns: [
				'employment_id',
				'loan_catalogue_id',
				'principal',
				'effective_range',
				'reference',
				'approval_reference',
				'disbursed_on'
			],
			with: {
				loan_repayments: {
					create: { columns: ['due_date', 'amount_due', 'sequence'] },
					update: { columns: ['due_date', 'amount_due', 'sequence'] },
					delete: {}
				}
			}
		}
	},
	delete: { transform: true }
});

type Repayment = {
	readonly id?: string;
	readonly loan_id?: string;
	readonly due_date?: unknown;
	readonly amount_due?: unknown;
	readonly sequence?: unknown;
	readonly payslip_id?: string | null;
};
type Loan = {
	readonly id: string;
	readonly employment_id: string;
	readonly loan_catalogue_id: string;
	readonly principal: unknown;
	readonly effective_range: unknown;
};
type Schedule = {
	readonly create?: readonly Repayment[];
	readonly update?: readonly { readonly target: string; readonly set: Repayment }[];
	readonly delete?: readonly string[];
};

const CAPTURED =
	'This repayment was settled by a payroll and cannot be changed. Delete the draft payroll holding it before changing its schedule.';

c.transform(async (inputs, ctx) => {
	// An explicitly typed alias, so a refusal narrows what follows it (TS control flow).
	const refuse: (message: string, at?: { field?: string }) => never = (message, at) =>
		ctx.refuse(message, at as never);
	const held = ctx.existing.map((row) => (row == null ? undefined : (plain(row) as Loan)));
	const loanIds = held.flatMap((row) => (row == null ? [] : [row.id]));
	// Delete guard: a recovered instalment is money history, so its agreement is never cascaded away.
	if (inputs.some((input) => '$delete' in input)) {
		const [settled] = await readAll<{ readonly loan_id: string }>(ctx.db, 'loan_repayments', {
			loan_id: { in: loanIds },
			payslip_id: { isNull: false }
		});
		if (settled != null)
			refuse(
				'A payroll recovered part of this loan, so it is kept. Delete the draft payroll holding it first.'
			);
		return inputs;
	}
	// A batch is one verb: past the delete guard every input is a create or an update.
	const writes = inputs.flatMap((input) => ('$delete' in input ? [] : [input]));
	const catalogueIds = [
		...new Set(
			writes.flatMap((input, index) => {
				const id = input.loan_catalogue_id ?? held[index]?.loan_catalogue_id;
				return id == null ? [] : [id];
			})
		)
	];
	const employmentIds = writes.flatMap((input, index) => {
		const id = input.employment_id ?? held[index]?.employment_id;
		return id == null ? [] : [id];
	});
	// One wave: the stored schedules, the catalogue rows and the people the batch names.
	const [stored, catalogues, subjectOf] = await Promise.all([
		readAll<Repayment & { readonly id: string }>(ctx.db, 'loan_repayments', {
			loan_id: { in: loanIds }
		}),
		readAll<{ readonly id: string; readonly code: string; readonly eligibility: string | null }>(
			ctx.db,
			'loan_catalogue',
			{ id: { in: catalogueIds } }
		),
		capSubjects(ctx.db, employmentIds)
	]);
	const catalogueById = new Map(catalogues.map((row) => [row.id, row]));

	return writes.map((input, index) => {
		const loan = held[index];
		const bound = boundToContract(input, loan);
		const employmentId = String(bound.employment_id ?? loan?.employment_id);
		const principal = decodeNumber(input.principal ?? loan?.principal ?? 0);
		if (!(principal > 0))
			refuse('A loan principal is a positive magnitude.', { field: 'principal' });
		const actions = (input.loan_repayments ?? {}) as Schedule;
		const creates = actions.create ?? [];
		const schedule = new Map<string, Repayment>(
			stored.filter((row) => row.loan_id === loan?.id).map((row) => [row.id, row])
		);
		for (const id of actions.delete ?? []) {
			const row = schedule.get(id);
			if (row == null) refuse('A repayment being removed is not part of this loan.');
			if (row.payslip_id != null)
				refuse(
					'This repayment was settled by a payroll and cannot be deleted. Delete the draft payroll holding it before changing its schedule.'
				);
			schedule.delete(id);
		}
		for (const { target, set } of actions.update ?? []) {
			const row = schedule.get(target);
			if (row == null) refuse('A repayment being changed is not part of this loan.');
			const next = { ...row, ...set };
			assertRepayment(next);
			const changed =
				decodeNumber(next.amount_due) !== decodeNumber(row.amount_due) ||
				decodeNumber(next.sequence) !== decodeNumber(row.sequence) ||
				dateKey(String(next.due_date)) !== dateKey(String(row.due_date));
			if (changed && row.payslip_id != null) refuse(CAPTURED);
			schedule.set(target, next);
		}
		for (const [position, row] of creates.entries()) {
			assertRepayment(row);
			schedule.set(`new:${position}`, row);
		}
		if (loan == null && creates.length === 0)
			refuse('Create the loan together with its complete repayment schedule.');
		if (schedule.size === 0)
			refuse('A loan repayment schedule cannot be empty. Delete an unused agreement instead.');
		const effectiveRange = input.effective_range ?? loan?.effective_range;
		const refusals = loanScheduleRefusals({
			principal,
			effectiveRange,
			rows: [...schedule.values()]
		});
		if (refusals.length) refuse(refusals.map((one) => one.message).join(' '));
		const catalogue = catalogueById.get(String(input.loan_catalogue_id ?? loan?.loan_catalogue_id));
		if (!catalogue)
			refuse('A loan must reference a loan catalogue entry.', { field: 'loan_catalogue_id' });
		// The form offers only the lines whose rule holds for the person; the transform holds the same rule on
		// the day the agreement opens, for a write that bypassed the form.
		const opens = dateKey(readRange(effectiveRange)?.start);
		const person = subjectOf(employmentId, opens);
		if (person == null) refuse('A loan names an employment contract on file.');
		if (
			(catalogue.eligibility ?? '').trim() !== '' &&
			opens !== '' &&
			!isEligible(catalogue.eligibility, person.subject)
		)
			refuse(
				`${catalogue.code} is not offered to ${person.label}: its eligibility rule does not hold for them.`
			);
		return {
			...bound,
			// A period does not sort; tables order by its first day, which the agreement stores.
			...(input.effective_range === undefined ? {} : { effective_from: opens }),
			// Every repayment rides its agreement's employment contract.
			...(creates.length === 0
				? {}
				: {
						loan_repayments: {
							...actions,
							create: creates.map((row) => ({ ...row, employment_id: employmentId }))
						}
					})
		} as never;
	});

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
});

export default c;
