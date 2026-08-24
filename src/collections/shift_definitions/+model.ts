import { custom, defineModel, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		company_id: uuid().notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		variant: custom('roster_code_variant').notNull(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'A code used by work patterns, rosters and imports: either a scheduled work window, a protected rest day, or another planned off day. Public holidays are overlaid from the observed holiday calendar.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-range',
		indexes: [{ columns: ['company_id', 'code'], unique: true }]
	}
);
