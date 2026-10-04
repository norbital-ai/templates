import { collection } from '@norbital-ai/bolt';

export default collection('entity', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
