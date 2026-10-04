import { collection } from '@norbital-ai/bolt';

export default collection('rule_set', {
	read: { fields: 'all' },
	create: { input: { columns: ['values'] } },
	update: { input: { columns: ['values'] } }
});
