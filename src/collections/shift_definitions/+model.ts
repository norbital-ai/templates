import { custom, defineModel, text } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		settings_code: text({ search: true }).notNull(),
		code: text({ search: true }).notNull(),
		name: text({ search: true }).notNull(),
		variant: custom('roster_code_variant').notNull(),
		effective_range: custom('instant_range', { precision: 'day' }).notNull()
	},
	{
		description:
			'A code used by work patterns, rosters and imports of one jurisdiction lineage: either a scheduled work window, a protected rest day, or another planned off day. Public holidays are overlaid from the observed holiday calendar.',
		recordLabel: ['code', 'name'],
		icon: 'lucide:calendar-range',
		indexes: [{ columns: ['settings_code', 'code'], unique: true }]
	}
);
