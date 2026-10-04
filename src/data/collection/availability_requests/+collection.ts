import { collection } from '@norbital-ai/bolt';

export default collection('availability_requests', {
	read: { fields: 'all', relations: 'all' },
	create: {
		input: {
			columns: ['phone', 'address', 'location', 'area', 'service', 'preference', 'helper', 'repeat']
		}
	},
	update: {
		input: { columns: ['location', 'starts', 'estimated', 'checked_at', 'problem', 'status'] }
	}
});
