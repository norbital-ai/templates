import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../lib/payroll_engine/statutory_fields.js';

export default model({
	description:
		'Regulatory rule sets grouped by family. Dated jurisdiction sets belong to a sealed jurisdiction version; original global policy sources retain explicit global ownership. Configuration holds eligibility, legal parameters and ordered programs, with qualified source identity.',
	icon: 'lucide:list-checks',
	label: 'name',
	fields: STATUTORY_FIELDS.rule_set
});
