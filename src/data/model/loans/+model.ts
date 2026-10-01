import { model } from '@norbital-ai/bolt';

/**
 * The agreement. Payroll reads its classification, disbursement and permission; each amount due under it is a
 * `loan_repayments` row, written through the loan and consumed by payroll. The loan owns its repayments.
 */
export default model({
	description:
		'One staff loan, salary advance, overpayment recovery or third-party deduction order (court, garnishment, union, government loan). The loan is the agreement; the amounts recovered under it are loan_repayments rows, scheduled up front or, for a rule-recovered order, recorded by the run that withheld them.',
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
		disbursed_on: { kind: 'date', optional: true },
		/** Who the recovery is owed to: the employer's own agreement, or an order the employer withholds for another. */
		creditor: { kind: 'enum', values: ['EMPLOYER', 'THIRD_PARTY'], default: 'EMPLOYER' },
		/** THIRD_PARTY: the court, agency, fund or union the withheld money is remitted to, and its order reference. */
		authority: { kind: 'text', optional: true },
		/**
		 * A money expression on the `order` site: what one payslip withholds (`min(0.25 * payment.net,
		 * payment.net - wage_floor)`). Empty is a scheduled agreement recovered by its `loan_repayments`;
		 * set, the run computes each period's amount and records it as a repayment, until the balance is gone.
		 */
		recovery_rule: { kind: 'text', optional: true },
		/** Among rule-recovered agreements on one payslip, lower is withheld first from what net pay is left. */
		priority: { kind: 'int', min: 0, default: 0 },
		/** The final payslip: RULE keeps the rule, BALANCE withholds the whole balance net pay carries, NONE withholds nothing. */
		on_exit: { kind: 'enum', values: ['RULE', 'BALANCE', 'NONE'], default: 'RULE' }
	},
	check: { positive: { principal: { gt: 0 } } },
	search: { text: ['reference'] }
});
