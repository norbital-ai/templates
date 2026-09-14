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
		/** The jurisdiction settings version this scheme belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		/** The law names it (cited by `authority`); a company-rule scheme is the entity's own levy. */
		is_statutory: boolean().notNull().default(true),
		/** The section of law transcribed; the hook requires it when `is_statutory`. */
		authority: text(),
		/**
		 * The span the scheme is assessed over. `MONTH` states that its bands are a monthly schedule —
		 * so a semi-monthly company charges the whole month's contribution once, on the month's wage,
		 * rather than half of it twice. At a monthly company the two are the same.
		 */
		assessment_period: enums(['PAY_PERIOD', 'MONTH']).notNull().default('PAY_PERIOD'),
		/** Who the scheme covers at all, as a predicate; empty is everyone. The run skips the rest. */
		eligibility: text().notNull().default(''),
		sequence: integer().notNull(),
		/**
		 * The scheme's arithmetic: relief, base transform and dependant share as CEL over the scheme
		 * context, with rounding, withholding threshold, period-table and relief-cap decisions typed.
		 */
		rules: custom('statutory_rules').notNull(),
		/** The ladder: the money expressions, in order, first matching `when` governs. Sealed with the version. */
		bands: custom('contribution_bands')
			.notNull()
			.default(sql`'[]'::jsonb`)
	},
	{
		description:
			'One statutory scheme of one jurisdiction settings version — EPF, SOCSO, EIS, PCB, HRDF and their equivalents — with the expressions that say what it charges and the bands that select them. Sealed with its version. Scheme-to-scheme relief is `scheme_reliefs`; source families declare the statutory opt-ins of their monetary outputs.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:landmark',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
