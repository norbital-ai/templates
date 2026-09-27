import { model } from '@norbital-ai/bolt';

/**
 * The agreement. Payroll reads its classification, disbursement and permission; each amount due under it is a
 * `loan_repayments` row, written through the loan and consumed by payroll. The loan owns its repayments.
 */
export default model({
	description:
		'One staff loan, salary advance or overpayment recovery agreement. The loan is the agreement; the amounts due under it are loan_repayments rows, which is what payroll consumes.',
	icon: 'lucide:hand-coins',
	label: ['reference', 'principal'],
	fields: {
		/** A positive magnitude in the employment's currency. */
		principal: { kind: 'decimal', scale: 2 },
		/** The window the agreement is live across and the schedule is spread over. */
		effective_range: { kind: 'period', of: 'date' },
		/** The range's first day, derived by the transform: tables order by it (a period does not sort). */
		effective_from: { kind: 'date' },
		/** The customer's own name for the loan. */
		reference: { kind: 'text', optional: true },
		/** The authority's written permission where this recovery uses a statutory exception. */
		approval_reference: { kind: 'text', optional: true },
		/** Actual payment date, distinct from the repayment agreement's effective window. */
		disbursed_on: { kind: 'date', optional: true }
	},
	check: { positive: { principal: { gt: 0 } } },
	search: { text: ['reference'] }
});
