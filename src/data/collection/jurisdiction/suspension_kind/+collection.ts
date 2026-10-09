import { collection } from '@norbital-ai/bolt';

const update_columns = [
	'code',
	'name',
	'authority',
	'counts_as_attended',
	'scheduled',
	'pay'
] as const;
const create_columns = [...update_columns, 'settings_id'] as const;

export default collection('suspension_kind', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
