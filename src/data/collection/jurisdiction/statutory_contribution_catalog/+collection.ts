import { collection } from '@norbital-ai/bolt';

export default collection('statutory_contribution_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
