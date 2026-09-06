import {
	custom,
	defineModel,
	enums,
	instant,
	integer,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';
export default defineModel(
	{
		employment_id: uuid().notNull(),
		leave_type_id: uuid().notNull(),
		account_kind: enums(['YEAR', 'EVENT']).notNull().default('YEAR'),
		event_reference: text({ search: true }).notNull().default(''),
		qualifying_date: instant({ precision: 'day' }),
		statutory_cohort_date: instant({ precision: 'day' }),
		eligibility_evidence: text(),
		allocation_units: numeric(),
		weekly_index: numeric(),
		leave_code: text({ search: true }).notNull(),
		leave_name: text({ search: true }).notNull(),
		opening_plan_id: uuid().notNull(),
		opening_statutory_profile_id: uuid().notNull(),
		leave_year: integer().notNull(),
		starts_on: instant({ precision: 'day' }).notNull(),
		ends_on: instant({ precision: 'day' }).notNull(),
		status: enums(['OPEN', 'CLOSED']).notNull().default('OPEN'),
		entitlement_days: numeric().notNull(),
		accrual_kind: enums(['UPFRONT', 'MONTHLY', 'UNLIMITED', 'EVENT']).notNull(),
		/** The year-end settlement variant compiled into this account: what unused days do. */
		/** The year-end rule compiled into this account, and which side decided it. */
		settlement: custom('leave_settlement').notNull(),
		settlement_source: enums(['STATUTE', 'COMPANY']).notNull(),
		/** The exit rule compiled into this account, and which side decided it. */
		exit_settlement: custom('leave_exit_settlement').notNull(),
		exit_settlement_source: enums(['STATUTE', 'COMPANY']).notNull(),
		calculation: custom('leave_account_calculation').notNull()
	},
	{
		description:
			'One sealed entitlement account for one employment and yearly or qualifying-event window. Balances are sums of append-only entries, never a live policy recalculation.',
		recordLabel: 'leave_name',
		icon: 'lucide:wallet-cards',
		indexes: [
			{ columns: ['employment_id', 'leave_code', 'leave_year', 'event_reference'], unique: true },
			{ columns: ['starts_on', 'ends_on'] }
		]
	}
);
