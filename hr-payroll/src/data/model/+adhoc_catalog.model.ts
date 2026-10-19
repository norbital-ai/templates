import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../lib/payroll_engine/statutory_fields.js';

export default model({
	description:
		'The ad hoc catalogue of one jurisdiction settings version: the classes of one-off pay — bonus, back pay, ex-gratia, festival and separation payments, claw-backs — with the bands that price and cap them and the schemes each counts toward. Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:hand-coins',
	label: 'name',
	fields: STATUTORY_FIELDS.adhoc_catalog
});
