import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { dateKey } from '../../lib/iso-day.js';
import { withContractInput } from '../../lib/employment-contract.js';
import { loanScheduleRefusals } from '../../lib/loan-schedule.js';
import { refuseIfCaptured } from '../../lib/scheduling/lock.js';
import type { Hooks, WorkspaceRow } from './$types.js';

const QUERY_LIMIT = 10_000;
type Repayment = Pick<
	WorkspaceRow<'loan_repayments'>,
	'id' | 'loan_id' | 'employment_id' | 'due_date' | 'amount_due' | 'sequence'
>;
type Loan = Pick<WorkspaceRow<'loans'>, 'id' | 'employment_id' | 'principal' | 'effective_range'>;
type Prepared = {
	readonly candidates: readonly Partial<Repayment>[];
	readonly loans: readonly Loan[];
	readonly stored: readonly Repayment[];
};

/** PostgreSQL JSON uses the session zone; Date compares instants, and the fraction retains subms precision. */
const sameInstant = (left: string | null | undefined, right: string | null | undefined) => {
	if (left === right) return true;
	if (!left || !right || Date.parse(left) !== Date.parse(right)) return false;
	const fraction = (value: string) => value.match(/\.(\d+)/)?.[1]?.replace(/0+$/, '') ?? '';
	return fraction(left) === fraction(right);
};

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const ids = inputs.flatMap((input) => (input.id == null ? [] : [input.id]));
				const prior = ids.length
					? yield* api.db.loan_repayments.findMany({
							where: { id: { in: ids } },
							limit: QUERY_LIMIT,
							columns: {
								id: true,
								loan_id: true,
								employment_id: true,
								due_date: true,
								amount_due: true,
								sequence: true
							}
						})
					: [];
				const byId = new Map(prior.map((row) => [row.id, row]));
				const candidates = inputs.map((input) => ({
					...(input.id == null ? {} : byId.get(input.id)),
					...input
				}));
				const loanIds = [
					...new Set(
						[...candidates, ...prior].flatMap((row) => (row.loan_id == null ? [] : [row.loan_id]))
					)
				];
				const loans = loanIds.length
					? yield* api.db.loans.findMany({
							where: { id: { in: loanIds } },
							limit: QUERY_LIMIT,
							columns: { id: true, employment_id: true, principal: true, effective_range: true }
						})
					: [];
				const stored = loanIds.length
					? yield* api.db.loan_repayments.findMany({
							where: { loan_id: { in: loanIds } },
							limit: QUERY_LIMIT,
							columns: {
								id: true,
								loan_id: true,
								employment_id: true,
								due_date: true,
								amount_due: true,
								sequence: true
							}
						})
					: [];
				return { candidates, loans, stored };
			}),
		perRecord: {
			before: {
				description:
					'Keep repayments on their agreement’s employment contract, validate the proposed schedule, and preserve captured repayment amounts.',
				handler: ({ input, existing, prepared, parent, api }) =>
					Effect.gen(function* () {
						const candidate = { ...existing, ...input };
						if (!(decodeNumber(candidate.amount_due) > 0))
							refuse(
								"A repayment amount due is a positive magnitude; part-recovery is the engine's business, never a smaller row."
							);
						const sequence = decodeNumber(candidate.sequence);
						if (!Number.isInteger(sequence) || sequence < 1)
							refuse('A repayment sequence is a positive whole number.');
						if (!dateKey(candidate.due_date))
							refuse('A repayment must state the day it comes due.');
						const repaymentChanged =
							existing != null &&
							(candidate.loan_id !== existing.loan_id ||
								candidate.employment_id !== existing.employment_id ||
								decodeNumber(candidate.amount_due) !== decodeNumber(existing.amount_due) ||
								sequence !== decodeNumber(existing.sequence) ||
								!sameInstant(candidate.due_date, existing.due_date));
						if (repaymentChanged)
							yield* refuseIfCaptured({
								capture: api.db.payslip_loan_repayment_inputs.findFirst({
									where: { loan_repayment_id: { eq: existing.id } },
									columns: { period: true }
								}),
								approvalId: null,
								action: 'Changing this repayment'
							});

						// Only the runtime can supply an enclosing agreement. It includes the parent's proposed
						// own fields, so creating or amending an agreement never reads an old or missing parent.
						const enclosingLoan =
							parent?.collection === 'loans' && parent.column === 'loan_id' ? parent : undefined;
						const loanId = enclosingLoan?.id ?? candidate.loan_id;
						const loan = enclosingLoan?.values ?? prepared.loans.find((row) => row.id === loanId);
						if (!loanId || !loan?.employment_id)
							refuse(
								'A repayment must reference an existing loan agreement and its employment contract.'
							);
						if (enclosingLoan && input.loan_id != null && input.loan_id !== loanId)
							refuse('A nested repayment cannot name a different loan agreement.');
						const enclosingEmployment =
							parent?.collection === 'employments' && parent.column === 'employment_id'
								? parent.id
								: undefined;
						const employmentId =
							candidate.employment_id ?? enclosingEmployment ?? loan.employment_id;
						if (
							employmentId !== loan.employment_id ||
							(enclosingEmployment != null && employmentId !== enclosingEmployment)
						)
							refuse('A repayment must use the same employment contract as its loan agreement.');
						const linked = withContractInput(
							{
								...input,
								employment_id: employmentId,
								...(existing != null && !repaymentChanged && input.due_date != null
									? { due_date: existing.due_date }
									: {})
							},
							existing
						);

						const changed = new Set(
							prepared.candidates.flatMap((row) => (row.id == null ? [] : [row.id]))
						);
						const schedules = enclosingLoan
							? [{ loan, rows: prepared.candidates }]
							: prepared.loans.map((agreement) => ({
									loan: agreement,
									rows: [
										...prepared.stored.filter(
											(row) => row.loan_id === agreement.id && !changed.has(row.id)
										),
										...prepared.candidates.filter((row) => row.loan_id === agreement.id)
									]
								}));
						for (const schedule of schedules) {
							const refusals = loanScheduleRefusals({
								principal: schedule.loan.principal,
								effectiveRange: schedule.loan.effective_range,
								rows: schedule.rows
							});
							if (refusals.length) refuse(refusals.map((one) => one.message).join(' '));
						}
						return linked;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Delete repayments only through a valid complete schedule replacement or unused agreement deletion; preserve captured repayments.',
				handler: ({ existing, parent, api }) =>
					Effect.gen(function* () {
						yield* refuseIfCaptured({
							capture: api.db.payslip_loan_repayment_inputs.findFirst({
								where: { loan_repayment_id: { eq: existing.id } },
								columns: { period: true }
							}),
							approvalId: null,
							action: 'Deleting this repayment'
						});
						if (
							parent?.collection !== 'loans' ||
							parent.column !== 'loan_id' ||
							parent.id !== existing.loan_id
						)
							refuse(
								'Edit the loan agreement’s complete repayment schedule instead of deleting a repayment directly.'
							);
					})
			}
		}
	}
} satisfies Hooks<Prepared>;
