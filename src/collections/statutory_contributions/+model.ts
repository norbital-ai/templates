import {
	custom,
	dateRange,
	defineModel,
	enums,
	integer,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		jurisdiction_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		authority: text().notNull(),
		payer: enums(['EMPLOYEE', 'EMPLOYER', 'BOTH']).notNull(),
		keyed_by: enums([
			'WAGE',
			'WAGE_AND_AGE',
			'WAGE_AND_MARITAL',
			'HEADCOUNT',
			'RISK_CLASS'
		]).notNull(),
		rounding: enums(['NONE', 'NEAREST_CENT', 'UP_TO_UNIT', 'TABLE']).notNull(),
		relief_for: uuid().array().notNull(),
		sequence: integer().notNull(),
		special_rules: text().array().notNull(),
		/**
		 * How this scheme charges derived overtime, and how it charges the excess overtime the daily
		 * total-work-hours boundary reclassifies.
		 *
		 * Overtime is derived from `time_entries` and the jurisdiction's own `overtime_rules`; it is
		 * never a pay component, so there is no `pay_components.policy` cell to state its treatment on.
		 * "EPF excludes overtime" is a fact about EPF — one row, one statement — and putting it on the
		 * catalogue instead let two companies in one jurisdiction disagree about what the law says.
		 *
		 * Each is a list rather than a single value because the position moves: Vietnamese PIT includes
		 * the overtime line until 1 July 2026 and excludes it after, and repricing an old period must
		 * read the entry that covered its own dates. An empty list is an undecided scheme, not an
		 * exempt one, and ACCUMULATE refuses to pay against it.
		 */
		overtime_treatments: custom('overtime_treatment_schedule').notNull(),
		overtime_excess_treatments: custom('overtime_treatment_schedule').notNull(),
		effective_range: dateRange().notNull()
	},
	{
		description:
			'One statutory scheme in one jurisdiction — EPF, SOCSO, EIS, PCB, HRDF and their equivalents — with who pays, what keys its bands, how it rounds and which named special rules it implements.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:landmark',
		// Plan 02 §7: jurisdiction =, code =, effective range &&.
		exclusions: [
			{
				name: 'statutory_contributions_no_overlap',
				elements: [
					{ expr: 'jurisdiction_id', with: '=' },
					{ expr: 'code', with: '=' },
					{ expr: 'norbital_daterange(effective_range)', with: '&&' }
				]
			}
		]
	}
);
