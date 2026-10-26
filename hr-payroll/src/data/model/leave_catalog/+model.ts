import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';

const create_columns = [
	'code',
	'name',
	'description',
	'references',
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
	'references',
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

export default model('leave_catalog', {
	description:
		'One leave definition: eligibility, computed entitlement, whether a day is unpaid, and whether it may be encashed. Manual entries decide carry-forward and encashment.',
	icon: 'lucide:calendar-days',
	label: 'name',
	fields: {
		...STATUTORY_FIELDS.leave_catalog,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'leave_catalog',
			owned: true
		}
	},
	read: 'all',
	create: {
		columns: create_columns
	},
	update: {
		columns: update_columns
	}
});
