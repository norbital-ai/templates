import {
	custom,
	dateRange,
	defineModel,
	integer,
	sql,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
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
		definition: custom('component_definition').notNull(),
		effective_range: dateRange().notNull()
	},
	{
		description:
			"The customer's complete pay catalogue: code, strict settlement/statutory policy, eligibility and polymorphic calculation definition in one row.",
		recordLabel: ['code'],
		icon: 'lucide:receipt',
		// Plan 02 §7: company =, code =, effective range &&.
		exclusions: [
			{
				name: 'pay_components_no_overlap',
				elements: [
					{ expr: 'company_id', with: '=' },
					{ expr: 'code', with: '=' },
					{ expr: 'bolt_daterange(effective_range)', with: '&&' }
				]
			}
		]
	}
);
