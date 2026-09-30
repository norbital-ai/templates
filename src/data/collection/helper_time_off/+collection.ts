import { collection } from '@norbital-ai/bolt';

export default collection('helper_time_off', {
	read: { fields: 'all' },
	create: { input: { columns: ['helper', 'period', 'reason'] } },
	update: { input: { columns: ['period', 'reason'] } },
	delete: {}
});
