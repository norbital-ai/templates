import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'code',
	'name',
	'authority',
	'destination',
	'direction',
	'bands',
	'eligibility',
	'amount_required',
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
	'amount_required'
] as const;

export default collection('loan_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
