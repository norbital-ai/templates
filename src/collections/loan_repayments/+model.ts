import {
	boolean,
	defineModel,
	instant,
	integer,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

/**
 * One amount due under an agreement, scoped to the same employment contract. A repayment is
 * recovered whole by exactly one payslip, or not yet at all.
 */
export default defineModel(
	{
		loan_id: uuid().notNull(),
		employment_id: uuid().notNull(),
		/** The day the amount comes due; the cutoff maps it to the run that recovers it. */
		due_date: instant({ precision: 'day' }).notNull(),
		/** A positive magnitude, recovered whole. */
		amount_due: numeric().notNull(),
		/** One-based position in the loan's plan. */
		sequence: integer().notNull(),
		/** A direction correction against the same loan line; sign -1. */
		as_adjustment_entry: boolean().notNull().default(false),
		/**
		 * The payslip that settled this row. Set by the payroll engine when a run recovers it,
		 * cleared when the draft run is deleted; while set, the row is frozen.
		 */
		payslip_id: uuid()
	},
	{
		description:
			'One amount due under a loan agreement, in the order it is recovered. Payroll consumes repayments, never the loan master, and links the one that settled it through `payslip_id`.',
		recordLabel: ['sequence', 'amount_due'],
		icon: 'lucide:calendar-clock',
		indexes: [
			{ columns: ['loan_id', 'sequence'], unique: true },
			{ columns: ['employment_id'] },
			{ columns: ['payslip_id'] }
		]
	}
);
