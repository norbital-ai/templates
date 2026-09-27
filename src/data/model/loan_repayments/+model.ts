import { model } from '@norbital-ai/bolt';

/** One amount due under an agreement, recovered whole by exactly one payslip, or not yet at all. */
export default model({
	description:
		'One amount due under a loan agreement, in the order it is recovered. Payroll consumes repayments, never the loan master, and links the one that settled it through `payslip_id`.',
	icon: 'lucide:calendar-clock',
	label: ['sequence', 'amount_due'],
	fields: {
		/** The day the amount comes due; the cutoff maps it to the run that recovers it. */
		due_date: { kind: 'date' },
		/** A positive magnitude, recovered whole. */
		amount_due: { kind: 'decimal', scale: 2 },
		/** One-based position in the loan's plan. */
		sequence: { kind: 'int', min: 1 },
		/** A direction correction against the same loan line. */
		as_adjustment_entry: { kind: 'bool', default: false }
	},
	unique: [{ fields: ['loan_id', 'sequence'] }]
});
