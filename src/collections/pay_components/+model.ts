import {
	boolean,
	custom,
	defineModel,
	integer,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/** The jurisdiction settings version this row belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		/** The one label of a pay item. Code and description are the same field; nothing else names it. */
		code: text({ search: true }).notNull(),
		/**
		 * The row the law names: OVERTIME, OVERTIME_EXCESS, LEAVE_PAYOUT, the unpaid-leave deduction,
		 * employer-cost rows. A company-rule row is the entity's own allowance or claim. Both are
		 * edited while the version is a draft and frozen once it is sealed.
		 */
		is_statutory: boolean().notNull().default(false),
		/** The component's economic direction: the kind fixes how it settles. */
		policy: custom('pay_component_policy').notNull(),
		/** Read-only projection used for grouping and reporting. */
		nature: text().generatedAlwaysAs(sql`policy ->> 'kind'`),
		/**
		 * How each statutory scheme, by code, charges this component. A scheme the map does not name
		 * is undecided and the run refuses at ACCUMULATE naming the component and the scheme.
		 */
		contribution_treatments: custom('contribution_treatments').notNull(),
		/** Formula/dependency and deduction-reduction order. */
		sequence: integer().notNull(),
		/** One CEL expression over the person context (`payroll_runs/lib/eligibility.ts`); '' is everyone. */
		eligibility: text().notNull().default(''),
		definition: custom('component_definition').notNull()
	},
	{
		description:
			'The pay catalogue of one jurisdiction settings version: code, economic direction, the treatment every statutory scheme gives it, eligibility and the polymorphic calculation definition. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code'],
		icon: 'lucide:receipt',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
