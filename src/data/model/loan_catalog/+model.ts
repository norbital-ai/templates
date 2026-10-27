import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../../lib/payroll_engine/statutory_fields.js';

const create_columns = [
	'code',
	'name',
	'references',
	'destination',
	'direction',
	'bands',
	'eligibility',
	'amount_required',
	'settings_id'
] as const;

const update_columns = [
	'code',
	'name',
	'references',
	'destination',
	'direction',
	'bands',
	'eligibility',
	'amount_required'
] as const;

export default model('loan_catalog', {
	description:
		'The loan catalogue of one jurisdiction settings version: the pay lines a loan recovers through, the schemes they opt into and who may borrow. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:landmark',
	label: 'name',
	fields: {
		...STATUTORY_FIELDS.loan_catalog,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'loan_catalog',
			owned: true
		}
	},
	read: 'all',
	create: {
		columns: { loan_catalog: create_columns }
	},
	update: {
		columns: { loan_catalog: update_columns }
	}
});
