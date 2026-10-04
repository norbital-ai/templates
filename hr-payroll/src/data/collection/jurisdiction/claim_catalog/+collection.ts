import { collection } from '@norbital-ai/bolt';

export default collection('claim_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
