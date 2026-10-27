import { model } from '@norbital-ai/bolt';
/** Days a helper is not available: leave, medical leave, anything else. */
export default model('helper_time_off', {
	description: 'A span of days a helper cannot take visits.',
	icon: 'lucide:calendar-off',
	label: 'reason',
	fields: {
		helper: { kind: 'ref', to: 'helpers', inverse: 'time_off', owned: true },
		period: { kind: 'period', of: 'date' },
		reason: { kind: 'enum', values: ['leave', 'medical', 'other'] }
	},
	noOverlap: [{ key: ['helper'], period: 'period' }],
	read: 'all',
	create: { columns: { helper_time_off: ['helper', 'period', 'reason'] } },
	update: { columns: { helper_time_off: ['period', 'reason'] } },
	delete: {}
});
