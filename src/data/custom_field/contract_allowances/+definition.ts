import { customField } from '@norbital-ai/bolt';
import { contractAllowancesFault } from '../../../lib/datatypes/contract_allowances.js';

const f = customField({
	description:
		'The allowances on a contract: one allowance class each with its monthly figure, prorated like basic salary.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: { catalogue_id: { kind: 'text' }, amount: { kind: 'number', min: 0 } }
		}
	}
});
export default f;
f.validate(contractAllowancesFault);
