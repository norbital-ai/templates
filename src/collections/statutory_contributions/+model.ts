import { custom, defineModel, enums, integer, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		jurisdiction_id: uuid().notNull(),
		statutory_profile_id: uuid().notNull(),
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
		 * Overtime is derived from `work_days` and the jurisdiction's own `overtime_rules`; it is
		 * never a pay component, so there is no `pay_components.policy` cell to state its treatment on.
		 * "EPF excludes overtime" is a fact about EPF — one row, one statement — and putting it on the
		 * catalogue instead let two companies in one jurisdiction disagree about what the law says.
		 *
		 * Each is a list rather than a single value because the position moves: a law revision that
		 * changes the position is a new profile version with its own schedule.
		 */
		overtime_treatments: custom('overtime_treatment_schedule').notNull(),
		overtime_excess_treatments: custom('overtime_treatment_schedule').notNull()
	},
	{
		description:
			'One statutory scheme scoped to one statutory profile — EPF, SOCSO, EIS, PCB, HRDF and their equivalents — with who pays, what keys its bands, how it rounds and which named special rules it implements. Versioned and sealed with the profile.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:landmark',
		indexes: [
			{ columns: ['statutory_profile_id', 'code'], unique: true },
			{ columns: ['jurisdiction_id'] }
		]
	}
);
