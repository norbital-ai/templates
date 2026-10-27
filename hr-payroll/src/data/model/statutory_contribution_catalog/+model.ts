import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';

const update_columns = [
	'code',
	'name',
	'label',
	'display_order',
	'references',
	'configuration'
] as const;

const create_columns = [...update_columns, 'settings_id'] as const;

export default model('statutory_contribution_catalog', {
	description:
		'One statutory catalog item of an immutable jurisdiction version. Its configuration declares qualified sources, eligibility, ordered assessment programs, dependencies and employer-month remittance behaviour. Original policy data and source identities remain inside the same configuration.',
	icon: 'lucide:landmark',
	label: 'name',
	fields: {
		...STATUTORY_FIELDS.statutory_contribution_catalog,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'statutory_contribution_catalog',
			owned: true
		}
	},
	read: 'all',
	create: {
		columns: { statutory_contribution_catalog: create_columns }
	},
	update: {
		columns: { statutory_contribution_catalog: update_columns }
	}
});
