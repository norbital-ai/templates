import { defineModel, instant, integer, numeric, uuid } from '@norbital-ai/bolt/authoring';

/**
 * One amount due under an agreement, scoped to the same employment contract.
 * A repayment can feed several payslips through partial recovery. The schedule states
 * the amount owed; payroll captures how much each regular run actually recovered.
 */
export default defineModel(
	{
		loan_id: uuid().notNull(),
		employment_id: uuid().notNull(),
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
		indexes: [{ columns: ['loan_id', 'sequence'], unique: true }, { columns: ['employment_id'] }]
	}
);
