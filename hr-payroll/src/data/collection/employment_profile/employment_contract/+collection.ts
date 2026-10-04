import { collection } from '@norbital-ai/bolt';

export default collection('employment_contract', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
