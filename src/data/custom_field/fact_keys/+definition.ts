import { customField } from '@norbital-ai/bolt';
import { fault } from '../../../lib/datatypes/fault.js';
import { standard } from '../../../lib/datatypes/fact_keys.js';

// `default_value` and `options` hold a boolean, a number or a string (an untagged union): `json`, checked below.
const f = customField({
	description:
		'Versioned input declarations: keys, labels, types, constraints, required values, statutory defaults and the evidence a value needs.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				key: { kind: 'text' },
				type: {
					kind: 'enum',
					values: ['boolean', 'number', 'string', 'date', 'instant', 'code']
				},
				table: { kind: 'text', optional: true },
				parent_fact: { kind: 'text', optional: true },
				label: { kind: 'text', optional: true },
				description: { kind: 'text', optional: true },
				scope: { kind: 'enum', values: ['EMPLOYMENT'], optional: true },
				required: { kind: 'bool', optional: true },
				required_when: { kind: 'text', optional: true },
				change_effect: {
					kind: 'enum',
					values: ['EVENT_MONTH', 'NEXT_YEAR_JANUARY', 'YEAR_START', 'MONTH_START'],
					optional: true
				},
				valid_when: { kind: 'text', optional: true },
				validation_message: { kind: 'text', optional: true },
				default_value: { kind: 'json', optional: true },
				options: { kind: 'list', of: { kind: 'json' }, optional: true },
				minimum: { kind: 'number', optional: true },
				maximum: { kind: 'number', optional: true },
				integer: { kind: 'bool', optional: true },
				min_length: { kind: 'int', min: 0, optional: true },
				import: { kind: 'bool', optional: true },
				evidence: {
					kind: 'object',
					optional: true,
					fields: {
						kind: { kind: 'enum', values: ['REFERENCE', 'FILE', 'REFERENCE_AND_FILE'] },
						when: { kind: 'text', optional: true },
						document: { kind: 'text', optional: true },
						valid_days: { kind: 'int', min: 1, optional: true }
					}
				}
			}
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
