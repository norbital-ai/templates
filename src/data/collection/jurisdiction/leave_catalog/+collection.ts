import { collection } from '@norbital-ai/bolt';

const create_columns = [
	'code',
	'name',
	'description',
	'authority',
	'eligibility',
	'evidence',
	'unit',
	'can_encash',
	'encash_on_exit',
	'entitlement',
	'schedule',
	'is_npl',
	'preceding_leave_same_event',
	'preceding_leave_contiguous',
	'requires_no_pay_origin',
	'pay_fraction',
	'paid_by',
	'evidence_after_days',
	'consumes_code',
	'settings_id'
] as const;
const update_columns = [
	'code',
	'name',
	'description',
	'authority',
	'eligibility',
	'evidence',
	'unit',
	'can_encash',
	'encash_on_exit',
	'entitlement',
	'schedule',
	'is_npl',
	'preceding_leave_same_event',
	'preceding_leave_contiguous',
	'requires_no_pay_origin',
	'pay_fraction',
	'paid_by',
	'evidence_after_days',
	'consumes_code'
] as const;

export default collection('leave_catalog', {
	read: { fields: 'all' },
	create: { input: { columns: create_columns } },
	update: { input: { columns: update_columns } }
});
