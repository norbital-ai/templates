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
	'qualifies_when',
	'amount_required',
	'counts_toward',
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
	'qualifies_when',
	'amount_required',
	'counts_toward'
] as const;

export default model('claim_catalog', {
	description:
		'The claim catalogue of one jurisdiction settings version: code, destination and direction, the bands that price and cap a claim (with the schemes each opts into). Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:receipt-text',
	label: 'name',
	fields: {
		...STATUTORY_FIELDS.claim_catalog,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'claim_catalog',
			owned: true
		}
	},
	read: 'all',
	create: {
		columns: { claim_catalog: create_columns }
	},
	update: {
		columns: { claim_catalog: update_columns }
	}
});
