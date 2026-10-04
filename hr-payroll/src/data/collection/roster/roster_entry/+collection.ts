import { collection } from '@norbital-ai/bolt';

export default collection('roster_entry', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
