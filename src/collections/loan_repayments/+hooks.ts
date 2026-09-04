import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { dateKey } from '../../lib/iso-day.js';
import { refuseIfCaptured } from '../../lib/scheduling/lock.js';
import type { Hooks } from './$types.js';
import { decodeNumber } from '@norbital-ai/std/json';

/**
 * One amount due under a loan, and the honesty the schedule's shape asks of it.
 *
 * A repayment may legitimately feed several payslips — net-pay protection can part-recover it — so
 * unlike a one-off entry, no junction row makes a repayment immutable. What the junction's restrict
 * edge protects is its HISTORY: a captured repayment cannot be deleted, and the engine's ceiling
 * keeps paid recovery across every payslip inside the amount due. Editing the row a payroll
 * consumed would rewrite money already taken, so a capture refuses edits exactly as it does for the
 * other three families.
 *
 * Cross-row shape (sum to principal) is highlighted on the loan form and does not rewrite
 * amounts. These hooks hold what a single row can state about itself.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses a repayment whose amount is not a positive magnitude, whose sequence is not a whole number of one or more, whose due date is missing, and any change to a repayment a payroll run has already captured.',
				handler: ({ input, existing, api }) => {
					const candidate = existing === undefined ? { ...input } : { ...existing, ...input };
					const amountDue = decodeNumber(candidate.amount_due);
					if (!(amountDue > 0))
						refuse(
							"A repayment amount due is a positive magnitude; part-recovery is the engine's business, never a smaller row."
						);
					const sequence = decodeNumber(candidate.sequence);
					if (!Number.isInteger(sequence) || sequence < 1)
						refuse('A repayment sequence is a positive whole number.');
					const due = dateKey(candidate.due_date);
					if (due == null || due === '') refuse('A repayment must state the day it comes due.');
					// Only an edit can disturb a capture: a create has no prior run that consumed it.
					if (existing === undefined) return input;
					return Effect.as(
						refuseIfCaptured({
							capture: api.db.payslip_loan_repayment_inputs.findFirst({
								where: { loan_repayment_id: { eq: existing.id } },
								columns: { period: true }
							}),
							approvalId: null,
							action: 'Changing this repayment'
						}),
						input
					);
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a repayment a payroll run has captured. A recovered repayment is money history.',
				handler: ({ existing, api }) =>
					refuseIfCaptured({
						capture: api.db.payslip_loan_repayment_inputs.findFirst({
							where: { loan_repayment_id: { eq: existing.id } },
							columns: { period: true }
						}),
						approvalId: null,
						action: 'Deleting this repayment'
					})
			}
		}
	}
} satisfies Hooks;
