import { custom, defineModel, enums, integer, text, uuid } from '@norbital-ai/bolt/authoring';
export default defineModel(
	{
		company_id: uuid().notNull(),
		leave_plan_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		/**
		 * The canonical statutory kind this type implements, when a statute mandates it. The
		 * statutory floor merges from the linked profile's `statutory_leave` member by this kind;
		 * `null` is a purely company-policy leave (a floating day, a wedding day) with no floor.
		 * The matching statutory floor is read from the independently versioned profile at account
		 * creation or reconciliation time.
		 */
		statutory_kind: text(),
		account_basis: enums(['YEAR', 'EVENT']).notNull().default('YEAR'),
		event_unit: enums(['DAYS', 'WEEKS']).notNull().default('DAYS'),
		event_window_months: integer(),
		eligibility: custom('eligibility_rules').notNull(),
		/** What this type's unused balance does when the employment ends, where the statute is silent. */
		exit_settlement: custom('leave_exit_settlement').notNull(),
		requires_certificate_after_days: integer(),
		accrual: custom('leave_accrual').notNull(),
		entitlement: custom('leave_entitlement').notNull(),
		payroll_effect: custom('leave_payroll_effect').notNull()
	},
	{
		description:
			'One yearly or qualifying-event leave rule inside a company leave-plan version. Statutory law stays independently versioned; account reconciliation merges the two by statutory kind.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-days',
		indexes: [
			{ columns: ['leave_plan_id', 'code'], unique: true },
			{ columns: ['company_id', 'code'] }
		]
	}
);
