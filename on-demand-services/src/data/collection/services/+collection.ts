import { collection } from '@norbital-ai/bolt';

const columns = ['name', 'skill', 'duration_minutes', 'price', 'description', 'active'] as const;

export default collection('services', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {}
});
