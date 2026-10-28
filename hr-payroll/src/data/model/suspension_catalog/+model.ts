import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';

const columns = [
	'code',
	'name',
	'references',
	'counts_as_attended',
	'scheduled',
	'eligibility',
	'quantity',
	'rate',
	'pay'
] as const;

export default model('suspension_catalog', {
	description:
		'The causes a work suspension may name in one jurisdiction version (an employer-caused shutdown, a natural disaster, a strike) and, as CEL, what a suspended day does: whether it counts as attended, stays a scheduled day, what one day pays (eligibility, quantity × rate), and the salary lines its days post (`pay`).',
	icon: 'lucide:calendar-off',
	label: 'name',
	fields: {
		...STATUTORY_FIELDS.suspension_catalog,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'suspension_catalog',
			owned: true
		}
	},
	// a kind names one row of its version: pricing and admission read it by code
	unique: [{ fields: ['settings_id', 'code'] }],
	read: 'all',
	create: {
		columns: { suspension_catalog: [...columns, 'settings_id'] }
	},
	update: {
		columns: { suspension_catalog: columns }
	}
});
