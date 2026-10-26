import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';

const update_columns = [
	'scope',
	'family',
	'code',
	'name',
	'references',
	'content_hash',
	'source_identity',
	'rules'
] as const;
export default model('rule_set', {
	description:
		'Regulatory rule sets grouped by family. Dated jurisdiction sets belong to a sealed jurisdiction version; original global policy sources retain explicit global ownership. Configuration holds eligibility, legal parameters and ordered programs, with qualified source identity.',
	icon: 'lucide:list-checks',
	label: 'name',
	fields: {
		...STATUTORY_FIELDS.rule_set,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'rule_set',
			owned: true,
			optional: true
		}
	},
	read: 'all',
	create: { columns: [...update_columns, 'settings_id'] },
	update: { columns: update_columns }
});
