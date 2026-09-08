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
		settings_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		is_statutory: boolean().notNull().default(false),
		policy: custom('component_policy').notNull(),
		nature: text().generatedAlwaysAs(sql`policy ->> 'kind'`),
		contribution_treatments: custom('contribution_treatments').notNull(),
		sequence: integer().notNull(),
		eligibility: text().notNull().default(''),
		definition: custom('entry_component_definition').notNull()
	},
	{
		description:
			'The Adhoc catalogue of one jurisdiction settings version: code, economic direction, the treatment every statutory scheme gives it, eligibility, and the unit, evidence and entitlement ceiling of the payment raised against it. Sealed with its version; the run cites the version it priced against.',
		recordLabel: ['code'],
		icon: 'lucide:wallet',
		indexes: [{ columns: ['settings_id', 'code'], unique: true }]
	}
);
