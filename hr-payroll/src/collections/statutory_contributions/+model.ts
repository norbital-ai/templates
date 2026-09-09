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
		rounding: enums(['NONE', 'NEAREST_CENT', 'UP_TO_UNIT', 'TABLE']).notNull(),
		relief_for: uuid().array().notNull(),
		/** Who the scheme covers at all, as a predicate; empty is everyone. The run skips the rest. */
		eligibility: text().notNull().default(''),
		sequence: integer().notNull(),
		special_rules: text().array().notNull(),
		/** The ladder: non-overlapping selector → award rungs, sealed with the version. */
		bands: custom('contribution_bands')
			.notNull()
			.default(sql`'[]'::jsonb`)
	},
	{
		description:
			'One statutory scheme of one jurisdiction settings version — EPF, SOCSO, EIS, PCB, HRDF and their equivalents — with its rate bands (each band selector and award say what keys it and who pays), how it rounds and which named special rules it implements. Sealed with its version. Source families declare the contribution treatment of their monetary outputs.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:landmark',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
