import { collection } from '@norbital-ai/bolt';

export default collection('leave_catalog_entry', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
