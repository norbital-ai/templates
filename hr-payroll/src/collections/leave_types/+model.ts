import { boolean, custom, defineModel, integer, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		statutory_profile_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		/**
		 * The canonical statutory kind this type implements, when a statute mandates it. The
		 * statutory floor merges from the linked profile's `statutory_leave` member by this kind;
		 * `null` is a purely company-policy leave (a floating day, a wedding day) with no floor.
		 * Frozen once the linked profile seals.
		 */
		statutory_kind: text(),
		eligibility: custom('eligibility_rules').notNull(),
		encash_on_exit: boolean().notNull(),
		requires_certificate_after_days: integer(),
		accrual: custom('leave_accrual').notNull(),
		entitlement: custom('leave_entitlement').notNull(),
		payroll_effect: custom('leave_payroll_effect').notNull()
	},
	{
		description:
			"A company's kind of leave within one statutory profile — the statutory floor comes from the profile by kind, and the organisation and employee layers, accrual, carry, eligibility and payroll effect are company content on the same version.",
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		indexes: [
			{ columns: ['company_id', 'code'], unique: true },
			{ columns: ['statutory_profile_id'] }
		]
	}
);
