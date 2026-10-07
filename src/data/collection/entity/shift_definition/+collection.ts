import { collection } from '@norbital-ai/bolt';

const create_columns = ['code', 'name', 'variant', 'effective_range', 'company_id'] as const;
const update_columns = ['code', 'name', 'variant', 'effective_range'] as const;

export default collection('shift_definition', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
