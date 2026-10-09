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
	'amount_required',
	'counts_toward',
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
	'amount_required',
	'counts_toward'
] as const;

export default collection('claim_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
