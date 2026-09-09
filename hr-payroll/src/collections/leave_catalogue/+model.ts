import { boolean, custom, defineModel, integer, text, uuid } from '@norbital-ai/bolt/authoring';

/** One revision of a leave definition. Availability and entitlement are computed on demand. */
export default defineModel(
	{
		settings_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		is_statutory: boolean().notNull().default(false),
		/** Required when `is_statutory`: the section of law the row transcribes. */
		authority: text(),
		/**
		 * One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`), evaluated
		 * on the leave year's rule date. `''` is everyone. A row an employee is not eligible for
		 * has no computed entitlement while ineligible, and an unpaid day of it is not deducted.
		 */
		eligibility: text().notNull().default(''),
		entitlement: custom('leave_entitlement').notNull(),
		/** An unpaid day is deducted under this leave's code (`lib/leave/pay-items.ts`). */
		paid: boolean().notNull().default(true),
		/** Scheme × {absence, encashment}: how each scheme charges the two lines this leave can produce. */
		treatments: custom('leave_treatments').notNull(),
		requires_certificate_after_days: integer()
	},
	{
		description:
			'One leave definition: eligibility, computed entitlement, whether a day is paid, and how each scheme charges an unpaid or encashed day. Manual entries decide carry-forward and encashment.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
