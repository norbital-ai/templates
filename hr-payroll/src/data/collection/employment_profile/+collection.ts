import { collection } from '@norbital-ai/bolt';

export default collection('employment_profile', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
