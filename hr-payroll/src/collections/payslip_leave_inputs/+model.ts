import { custom, defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

/** Exact dated charges and settled Leave outputs, captured atomically with a payslip.
 * One approved time-off entry can span multiple periods. Each capture claims only its own dates.
 * Paid reversals use these frozen amounts and treatments; catalogue or salary changes cannot
 * reprice an earlier payment. Deleting a draft releases these settlement claims.
 */
export default defineModel(
	{
		payslip_id: uuid().notNull(),
		leave_entry_id: uuid().notNull(),
		period: text().notNull(),
		/** The exact date slice settled here; empty for a monetary entry. */
		charges: custom('leave_charges').notNull(),
		/** Signed change to employee pay, retained for an exact later reversal. */
		gross_amount: custom('money').notNull(),
		/** Frozen output metadata and amounts; paid reversals invert these exact items. */
		pay_items: custom('leave_pay_items').notNull()
	},
	{
		description:
			'Engine-owned dated Leave input and payment evidence. The payroll engine writes captures atomically with the run; users cannot edit them.',
		icon: 'lucide:link',
		indexes: [
			// Composite only. A request that spans two payroll windows is captured once per period
			// for the days in that window; the same request twice on one payslip is what this stops.
			{ columns: ['payslip_id', 'leave_entry_id'], unique: true }
		]
	}
);
