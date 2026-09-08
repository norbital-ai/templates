import { withContractInput } from '../../lib/employment-contract.js';
import { loanScheduleRefusals } from '../../lib/loan-schedule.js';
import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';
import { decodeNumber } from '@norbital-ai/std/json';

/** Validate the agreement; repayment hooks validate its proposed schedule and contract link. */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Require a complete nonempty repayment schedule, preserve its agreement total and period, and accept only payroll-settled deduction catalogue entries.',
				handler: ({ input, existing, relationshipSizes, api }) =>
					Effect.gen(function* () {
						const principal = decodeNumber(input.principal ?? existing?.principal ?? 0);
						if (!(principal > 0)) refuse('A loan principal is a positive magnitude.');
						const scheduleSize = relationshipSizes.repayment_loan;
						if (existing == null && !(scheduleSize != null && scheduleSize > 0))
							refuse('Create the loan together with its complete repayment schedule.');
						if (scheduleSize === 0)
							refuse(
								'A loan repayment schedule cannot be empty. Delete an unused agreement instead.'
							);
						if (
							existing != null &&
							scheduleSize == null &&
							(input.principal !== undefined || input.effective_range !== undefined)
						) {
							const rows = yield* api.db.loan_repayments.findMany({
								where: { loan_id: { eq: existing.id } },
								columns: { due_date: true, amount_due: true, sequence: true },
								limit: 10_000
							});
							const refusals = loanScheduleRefusals({
								principal,
								effectiveRange: input.effective_range ?? existing.effective_range,
								rows
							});
							if (refusals.length) refuse(refusals.map((one) => one.message).join(' '));
						}
						const catalogue = yield* api.db.loan_catalogue.findFirst({
							where: { id: { eq: String(input.loan_catalogue_id ?? existing?.loan_catalogue_id) } },
							columns: { code: true, definition: true, nature: true }
						});
						if (!catalogue) refuse('A loan must reference a loan catalogue entry.');
						if (
							catalogue.definition?.source !== 'ENTRY' ||
							catalogue.definition.settlement !== 'PAYROLL'
						)
							refuse(
								`Loan recoveries settle as payroll deductions, and component ${catalogue.code} is not a payroll-settled entry.`
							);
						if (catalogue.nature !== 'DEDUCTION')
							refuse(
								`Loan recoveries settle as deductions, and component ${catalogue.code} is a ${catalogue.nature}.`
							);
						return withContractInput(input, existing);
					})
			}
		}
	}
} satisfies Hooks;
