import { custom, defineModel, sql, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		/** The entity facts in force from the range's start: sector, consent, establishment tests. */
		facts: custom('entity_facts')
			.notNull()
			.default(sql`'{}'::jsonb`),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'A dated revision of an entity’s declared jurisdiction facts. The revision in force on a calculation date governs historical valuation; the company row itself stays the current record.',
		recordLabel: 'company_id',
		icon: 'lucide:history',
		// Company = and inclusive range && — the same `[]` reading `coversDate` applies, so two
		// revisions can never claim one day.
		exclusions: [
			{
				name: 'company_facts_no_overlap',
				elements: [
					{ expr: 'company_id', with: '=' },
					{
						expr: "daterange(lower(bolt_daterange(effective_range - 'end')), upper(bolt_daterange(effective_range - 'start')), '[]')",
						with: '&&'
					}
				]
			}
		]
	}
);
