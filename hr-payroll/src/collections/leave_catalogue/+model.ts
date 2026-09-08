import { boolean, custom, defineModel, integer, text, uuid } from '@norbital-ai/bolt/authoring';

/** One revision of a leave definition. Availability and service bands are computed on demand. */
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
		 * has no computed entitlement while ineligible.
		 */
		eligibility: text().notNull().default(''),
		entitlement: custom('leave_entitlement').notNull(),
		payroll_effect: custom('leave_payroll_effect').notNull(),
		encashment: custom('pay_item_metadata').notNull(),
		requires_certificate_after_days: integer()
	},
	{
		description:
			'One leave definition: eligibility, computed entitlement, paid/unpaid treatment and encashment pay metadata. Manual entries decide carry-forward and encashment.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
