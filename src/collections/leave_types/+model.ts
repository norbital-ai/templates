import { boolean, custom, defineModel, integer, text, uuid } from '@norbital-ai/bolt/authoring';

/**
 * The leave catalogue: one row per jurisdiction settings version per code. A statutory row
 * (`is_statutory`) is the law the version transcribes, cited by `authority`; a company-rule row is
 * the entity's own policy. Everything the reconciler needs to generate entitlements is on the row,
 * and the row is sealed with its version: the version in force on a leave year's rule date is the
 * catalogue that year is generated from, and an entitlement keeps the settlement it was sealed with.
 */
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
		 * generates no entitlement at all.
		 */
		eligibility: text().notNull().default(''),
		/** Service bands: the band whose `band_from` months is the highest at or below service wins. */
		entitlement: custom('leave_entitlement').notNull(),
		/** MONTHLY, UPFRONT or UNLIMITED, with what the year end does with the unused balance. */
		accrual: custom('leave_accrual').notNull(),
		/** What the unused balance does when the employment ends. */
		exit_settlement: custom('leave_exit_settlement').notNull(),
		payroll_effect: custom('leave_payroll_effect').notNull(),
		requires_certificate_after_days: integer()
	},
	{
		description:
			'One leave type of one jurisdiction settings version: its eligibility, service bands, accrual, year-end and exit settlement, and whether it is the law (cited) or company rule. Sealed with its version.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
