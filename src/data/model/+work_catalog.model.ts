import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../lib/payroll_engine/statutory_fields.js';

export default model({
	description:
		'The pay lines a contract and its roster produce for one jurisdiction version: basic salary, overtime and no-pay leave. Each row prices one line as quantity × rate, both CEL over the payslip context, and names the schemes it counts toward.',
	icon: 'lucide:clock',
	label: 'name',
	fields: STATUTORY_FIELDS.work_catalog
});
