import { model } from '@norbital-ai/bolt';

/** Days a helper is not available: leave, medical leave, anything else. */
export default model({
	description: 'A span of days a helper cannot take visits.',
	icon: 'lucide:calendar-off',
	label: 'reason',
	fields: {
		period: { kind: 'period', of: 'date' },
		reason: { kind: 'enum', values: ['leave', 'medical', 'other'] }
	},
	noOverlap: [{ key: ['helper'], period: 'period' }]
});
