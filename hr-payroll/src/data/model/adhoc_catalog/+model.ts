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
	'raise_on_exit',
	'payable_after_exit',
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
	'counts_toward',
	'raise_on_exit',
	'payable_after_exit'
] as const;

export default model('adhoc_catalog', {
	description:
		'The ad hoc catalogue of one jurisdiction settings version: the classes of one-off pay — bonus, back pay, ex-gratia, festival and separation payments, claw-backs — with the bands that price and cap them and the schemes each counts toward. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:hand-coins',
	label: 'name',
	fields: {
		...STATUTORY_FIELDS.adhoc_catalog,
		settings_id: {
			kind: 'ref',
			to: 'jurisdiction_settings',
			inverse: 'adhoc_catalog',
			owned: true
		}
	},
	read: 'all',
	create: {
		columns: create_columns
	},
	update: {
		columns: update_columns
	}
});
