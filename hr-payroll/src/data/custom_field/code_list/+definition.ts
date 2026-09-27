import { customField } from '@norbital-ai/bolt';
import { fault } from '../../../lib/datatypes/fault.js';
import { standard } from '../../../lib/datatypes/code_list.js';

const f = customField({
	description:
		'A list of codes: the schemes a class counts toward (a part after a dot), or the parts a scheme declares.',
	shape: { kind: 'list', of: { kind: 'text' } }
});
export default f;
f.validate((value) => fault(standard, value));
