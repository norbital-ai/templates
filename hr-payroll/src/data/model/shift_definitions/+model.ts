import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'A code used by one entity’s work patterns, rosters and imports: either a scheduled work window, a protected rest day, or another planned off day. Public holidays are overlaid from the observed holiday calendar.',
	icon: 'lucide:calendar-range',
	label: 'name',
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		variant: { kind: 'custom', of: 'roster_code_variant' },
		effective_range: { kind: 'period', of: 'date' }
	},
	unique: [{ fields: ['company_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
