import { collection } from '@norbital-ai/bolt';

const columns = ['name', 'phone', 'email', 'address', 'location', 'area', 'notes'] as const;

export default collection('customers', {
	read: { fields: 'all', relations: 'all' },
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {}
});
