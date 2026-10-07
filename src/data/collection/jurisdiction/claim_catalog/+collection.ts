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
	'leave_code',
	'unit_cap',
	'claim_window_months',
	'employer_premium_scheme',
	'minimum_service_months',
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
	'leave_code',
	'unit_cap',
	'claim_window_months',
	'employer_premium_scheme',
	'minimum_service_months'
] as const;

export default collection('claim_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
