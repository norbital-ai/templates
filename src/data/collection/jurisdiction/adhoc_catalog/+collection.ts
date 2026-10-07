import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'code',
	'name',
	'authority',
	'destination',
	'direction',
	'bands',
	'eligibility',
	'qualifies_when',
	'evidence',
	'counts_toward',
	'raised_by',
	'schedule',
	'settings_id'
] as const;
const update_columns = [
	'code',
	'name',
	'authority',
	'destination',
	'direction',
	'bands',
	'eligibility',
	'qualifies_when',
	'evidence',
	'counts_toward',
	'raised_by',
	'schedule'
] as const;

export default collection('adhoc_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
