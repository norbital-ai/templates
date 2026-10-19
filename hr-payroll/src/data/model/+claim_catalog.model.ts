import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../lib/payroll_engine/statutory_fields.js';

export default model({
	description:
		'The claim catalogue of one jurisdiction settings version: code, destination and direction, the bands that price and cap a claim (with the schemes each opts into). Sealed with its version; the run cites the version it priced against.',
	icon: 'lucide:receipt-text',
	label: 'name',
	fields: STATUTORY_FIELDS.claim_catalog
});
