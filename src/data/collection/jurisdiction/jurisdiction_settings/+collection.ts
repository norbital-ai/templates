import { collection } from '@norbital-ai/bolt';

export default collection('jurisdiction_settings', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
