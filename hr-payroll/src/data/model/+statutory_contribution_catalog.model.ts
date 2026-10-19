import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../lib/payroll_engine/statutory_fields.js';

export default model({
	description:
		'One statutory catalog item of an immutable jurisdiction version. Its configuration declares qualified sources, eligibility, ordered assessment programs, dependencies and employer-month remittance behaviour. Original policy data and source identities remain inside the same configuration.',
	icon: 'lucide:landmark',
	label: 'name',
	fields: STATUTORY_FIELDS.statutory_contribution_catalog
});
