import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'code',
	'name',
	'eligibility',
	'amount',
	'authority',
	'counts_toward',
	'destination',
	'direction',
	'settings_id'
] as const;
const update_columns = [
	'code',
	'name',
	'eligibility',
	'amount',
	'authority',
	'counts_toward',
	'destination',
	'direction'
] as const;

export default collection('allowance_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
