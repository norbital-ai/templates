import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'code',
	'name',
	'description',
	'authority',
	'eligibility',
	'unit',
	'can_encash',
	'encash_on_exit',
	'encash_at_window_end',
	'entitlement',
	'is_npl',
	'pay_fraction',
	'share_by',
	'consumes_code',
	'settings_id'
] as const;
const update_columns = [
	'code',
	'name',
	'description',
	'authority',
	'eligibility',
	'unit',
	'can_encash',
	'encash_on_exit',
	'encash_at_window_end',
	'entitlement',
	'is_npl',
	'pay_fraction',
	'share_by',
	'consumes_code'
] as const;

export default collection('leave_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
