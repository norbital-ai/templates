import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';

const create_columns = [
	'code',
	'name',
	'eligibility',
	'amount',
	'references',
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
	'references',
	'counts_toward',
	'destination',
	'direction'
] as const;

export default model('allowance_catalog', {
	description:
		'Static allowance definitions governed by a jurisdiction snapshot. Qualified employee/entity inputs produce a payslip line directly; no allowance entry is created.',
	icon: 'lucide:calendar-clock',
	label: 'code',
	fields: {
		...STATUTORY_FIELDS.allowance_catalog,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'allowance_catalog',
			owned: true
		}
	},
	read: 'all',
	create: {
		columns: { allowance_catalog: create_columns }
	},
	update: {
		columns: { allowance_catalog: update_columns }
	}
});
