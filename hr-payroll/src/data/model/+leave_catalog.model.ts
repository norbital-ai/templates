import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../lib/payroll_engine/statutory_fields.js';

export default model({
	description:
		'One leave definition: eligibility, computed entitlement, whether a day is unpaid, and whether it may be encashed. Manual entries decide carry-forward and encashment.',
	icon: 'lucide:calendar-days',
	label: 'name',
	fields: STATUTORY_FIELDS.leave_catalog
});
