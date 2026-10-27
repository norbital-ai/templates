import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';

const columns = [
	'code',
	'name',
	'references',
	'component_code',
	'eligibility',
	'quantity',
	'rate',
	'prorated',
	'denominator',
	'destination',
	'direction',
	'counts_toward'
] as const;

export default model('work_catalog', {
	description:
		'The pay lines a contract and its roster produce for one jurisdiction version: basic salary, overtime and no-pay leave. Each row prices one line as quantity × rate, both CEL over the payslip context, and names the schemes it counts toward.',
	icon: 'lucide:clock',
	label: 'name',
	fields: {
		...STATUTORY_FIELDS.work_catalog,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'work_catalog',
			owned: true
		}
	},
	read: 'all',
	create: {
		columns: { work_catalog: [...columns, 'settings_id'] }
	},
	update: {
		columns: { work_catalog: columns }
	}
});
