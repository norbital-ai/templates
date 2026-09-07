import {
	boolean,
	custom,
	defineModel,
	enums,
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
		policy: custom('component_policy').notNull(),
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
		definition: custom('component_definition').notNull(),
		/**
		 * Which shape an entry against this component takes — the arm of `component_entry_event` its
		 * entries must declare, and therefore which optional columns they may carry.
		 *
		 * This is the fact the entry form used to ask for on every row, and the reason the ask was
		 * wrong: across 726 seeded entries, 37 of 38 components used exactly one arm. It was never an
		 * operator decision; it is a property of the component, and it belongs here where it is stated
		 * once and enforced, rather than restated per entry and free to drift.
		 *
		 * NULL when the component takes no entries at all — a `definition.source` of `SCHEDULE`,
		 * `FORMULA`, `DERIVED_OVERTIME` or `LEAVE_PAYOUT` is fed by the engine, not by a person. The
		 * pairing in both directions ("`ENTRY` requires a kind, everything else forbids one") is an
		 * implication rule, which Postgres could state as a CHECK and this authoring surface cannot,
		 * so `+hooks.ts` carries it. That gap is the reason the seed bank could hold five entries the
		 * arm rule already refused.
		 */
		entry_kind: enums(['CLAIM', 'ALLOWANCE', 'BONUS', 'ARREARS', 'MANUAL_ADJUSTMENT'])
	},
	{
		description:
			'The pay catalogue of one jurisdiction settings version: code, economic direction, the treatment every statutory scheme gives it, eligibility, the polymorphic calculation definition, and — for the components a person raises entries against — the one entry shape those entries must take. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code'],
		icon: 'lucide:receipt',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
