import { customField } from '@norbital-ai/bolt';
import { fault } from '../../../lib/datatypes/fault.js';
import { standard } from '../../../lib/datatypes/reference_tables.js';

const f = customField({
	description:
		'The tables a settings version declares: each table’s name, lookup keys, typed value columns and, for a band table, the inclusivity of its range bounds. The rows are the version’s reference rows.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				name: { kind: 'text' },
				label: { kind: 'text', optional: true },
				keys: { kind: 'list', of: { kind: 'text' } },
				range: {
					kind: 'object',
					optional: true,
					fields: { from_inclusive: { kind: 'bool' }, to_inclusive: { kind: 'bool' } }
				},
				columns: { kind: 'custom', of: 'fact_keys' }
			}
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
