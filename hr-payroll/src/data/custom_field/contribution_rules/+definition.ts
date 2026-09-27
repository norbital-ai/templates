import { customField } from '@norbital-ai/bolt';
import { fault } from '../../../lib/datatypes/fault.js';
import { standard } from '../../../lib/datatypes/contribution_rules.js';

const f = customField({
	description:
		'The rules of one statutory contribution as expressions: each the condition it governs under and the employee and employer money it charges. Rules are read in order; the first condition that holds governs. A floor is the first rule, the terminal rule an open-ended condition; no expression may quietly reuse another rule.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				when: { kind: 'text' },
				employee: { kind: 'text' },
				employer: { kind: 'text' },
				per_unit: { kind: 'bool', optional: true },
				rebate: { kind: 'text', optional: true },
				deduction: { kind: 'text', optional: true },
				refusal: { kind: 'text', optional: true },
				warning: { kind: 'text', optional: true }
			}
		}
	}
});
export default f;
f.validate((value) => fault(standard, value));
