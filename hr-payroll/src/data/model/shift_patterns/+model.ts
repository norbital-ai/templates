import { model } from '@norbital-ai/bolt';

/**
 * A named shift pattern: the base every employment on it projects its days from. The cycle is anchored at this
 * row's effective start; a `work_days` row overrides one day.
 */
export default model({
	description:
		'A named shift pattern of one legal entity: the repeating day cycle of roster codes, or the declared week (days and paid minutes), that employment terms point at. The days a week a contract works are the pattern’s; a cycle projects every day an employment has no roster row for.',
	icon: 'lucide:repeat',
	label: 'name',
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text' },
		pattern: { kind: 'custom', of: 'work_pattern' },
		effective_range: { kind: 'period', of: 'date' }
	},
	unique: [{ fields: ['company_id', 'code'] }],
	search: { text: ['code', 'name'] }
});
