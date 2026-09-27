import { collection } from '@norbital-ai/bolt';

export default collection('shift_definitions', {
	read: { fields: 'all' },
	create: { input: { columns: ['company_id', 'code', 'name', 'variant', 'effective_range'] } },
	update: { input: { columns: ['company_id', 'code', 'name', 'variant', 'effective_range'] } },
	delete: {}
});
