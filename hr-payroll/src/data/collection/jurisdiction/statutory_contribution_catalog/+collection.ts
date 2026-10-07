import { collection } from '@norbital-ai/bolt';

const create_columns = ['code', 'name', 'authority', 'configuration', 'settings_id'] as const;
const update_columns = ['code', 'name', 'authority', 'configuration'] as const;

export default collection('statutory_contribution_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
