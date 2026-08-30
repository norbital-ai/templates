import { defineModel, instant, integer, numeric, uuid } from '@norbital-ai/bolt/authoring';

/**
 * One amount due under a loan agreement.
 *
 * This is the row payroll consumes — never the loan master. One repayment can appear on several
 * payslips when net-pay protection prevents full recovery, and the input junction's
 * `unique(payslip_id, loan_repayment_id)` plus the engine's ceiling over what paid runs actually
 * took are what keep that multi-payslip consumption honest.
 *
 * `sequence` orders the plan and makes the schedule's shape queryable; the repayment dates strictly
 * increase along it and the amounts sum to the loan's principal to the cent, which is what the
 * provisioning schedule the loans screen builds guarantees and what the write hooks and the loan
 * update path check.
 */
export default defineModel(
	{
		loan_id: uuid().notNull(),
		/** The day the amount comes due; the cutoff maps it to the run that recovers it. */
		due_date: instant({ precision: 'day' }).notNull(),
		/** A positive magnitude. Part-recovery is the engine's business, never a smaller row. */
		amount_due: numeric().notNull(),
		/** One-based position in the loan's plan. */
		sequence: integer().notNull()
	},
	{
		description:
			'One amount due under a loan agreement, in the order it is recovered. Payroll consumes repayments, never the loan master.',
		recordLabel: ['sequence', 'amount_due'],
		icon: 'lucide:calendar-clock',
		indexes: [{ columns: ['loan_id', 'sequence'], unique: true }]
	}
);
