import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'settings_code',
	'name',
	'registration_number',
	'pay_cutoff_day',
	'late_arrival_grace_minutes',
	'pay_frequency',
	'risk_class',
	'region',
	'facts',
	'time_zone',
	'disbursement_account',
	'effective_range'
] as const;
const update_columns = [
	'settings_code',
	'name',
	'registration_number',
	'pay_cutoff_day',
	'late_arrival_grace_minutes',
	'pay_frequency',
	'risk_class',
	'region',
	'facts',
	'time_zone',
	'disbursement_account',
	'effective_range'
] as const;

export default collection('entity', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
