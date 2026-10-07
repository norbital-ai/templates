import { collection } from '@norbital-ai/bolt';

const create_columns = ['period', 'employment_id'] as const;
const update_columns = ['period', 'employment_id'] as const;

export default collection('roster', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
