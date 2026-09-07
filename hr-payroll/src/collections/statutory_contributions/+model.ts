import { boolean, defineModel, enums, integer, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		/** The jurisdiction settings version this scheme belongs to, sealed with it. */
		settings_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		/** The law names it (cited by `authority`); a company-rule scheme is the entity's own levy. */
		is_statutory: boolean().notNull().default(true),
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
		special_rules: text().array().notNull()
	},
	{
		description:
			'One statutory scheme of one jurisdiction settings version — EPF, SOCSO, EIS, PCB, HRDF and their equivalents — with who pays, what keys its bands, how it rounds and which named special rules it implements. Sealed with its version; what it does with derived overtime is stated on the OVERTIME and OVERTIME_EXCESS catalogue rows like every other treatment.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:landmark',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
