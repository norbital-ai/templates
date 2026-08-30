import { custom, defineModel, integer, sql, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		statutory_profile_id: uuid().notNull(),
		/** The one label of a pay item. Code and description are the same field; nothing else names it. */
		code: text({ search: true }).notNull(),
		/**
		 * The component's complete economic type. The discriminated union fixes its settlement direction
		 * and owns every effective-dated statutory decision; there is no component-types lookup table.
		 */
		policy: custom('pay_component_policy').notNull(),
		/** Read-only projection used for grouping and reporting. */
		nature: text().generatedAlwaysAs(sql`policy ->> 'kind'`),
		/** Formula/dependency and deduction-reduction order. */
		sequence: integer().notNull(),
		eligibility: custom('eligibility_rules').notNull(),
		definition: custom('component_definition').notNull()
	},
	{
		description:
			"The company's pay catalogue within one statutory profile: code, strict settlement/statutory policy, eligibility and polymorphic calculation definition. Versioned and sealed with the profile it belongs to.",
		recordLabel: ['code'],
		icon: 'lucide:receipt',
		indexes: [
			{ columns: ['company_id', 'code'], unique: true },
			{ columns: ['statutory_profile_id'] }
		]
	}
);
