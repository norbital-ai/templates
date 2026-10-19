import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../lib/payroll_engine/statutory_fields.js';

export default model({
	description:
		'Static allowance definitions governed by a jurisdiction snapshot. Qualified employee/entity inputs produce a payslip line directly; no allowance entry is created.',
	icon: 'lucide:calendar-clock',
	label: 'code',
	fields: STATUTORY_FIELDS.allowance_catalog
});
