import { customField } from '@norbital-ai/bolt';
import {
	RETURN_ALIGNS,
	RETURN_CADENCES,
	RETURN_ENCODINGS,
	RETURN_FORMATS,
	RETURN_LINE_ENDS,
	returnsFault
} from '../../../lib/datatypes/returns.js';

const column = {
	kind: 'object',
	fields: {
		key: { kind: 'text' },
		label: { kind: 'text', optional: true },
		value: { kind: 'text' },
		width: { kind: 'int', optional: true },
		align: { kind: 'enum', values: RETURN_ALIGNS, optional: true },
		pad: { kind: 'text', optional: true },
		pattern: { kind: 'text', optional: true },
		truncate: { kind: 'bool', optional: true }
	}
} as const;
const records = {
	kind: 'list',
	optional: true,
	of: { kind: 'object', fields: { columns: { kind: 'list', of: column } } }
} as const;

const f = customField({
	description:
		'The statutory returns and bank files a version declares: the cadence, the population, every column as an expression over the filing site, the record layout and the duty the generated file evidences.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				code: { kind: 'text' },
				label: { kind: 'text', optional: true },
				authority: { kind: 'text', optional: true },
				cadence: { kind: 'enum', values: RETURN_CADENCES },
				payer_bank: { kind: 'text', optional: true },
				population: { kind: 'text', optional: true },
				identity_patterns: {
					kind: 'list',
					optional: true,
					of: {
						kind: 'object',
						fields: { type: { kind: 'text' }, pattern: { kind: 'text' } }
					}
				},
				columns: { kind: 'list', of: column },
				header_records: records,
				trailer_records: records,
				format: {
					kind: 'object',
					fields: {
						kind: { kind: 'enum', values: RETURN_FORMATS },
						header: { kind: 'bool', optional: true },
						delimiter: { kind: 'text', optional: true },
						encoding: { kind: 'enum', values: RETURN_ENCODINGS, optional: true },
						line_end: { kind: 'enum', values: RETURN_LINE_ENDS, optional: true },
						final_line_end: { kind: 'bool', optional: true },
						name: { kind: 'text', optional: true }
					}
				},
				evidence: {
					kind: 'object',
					optional: true,
					fields: { duty: { kind: 'text' }, fact_key: { kind: 'text' } }
				}
			}
		}
	}
});
export default f;

// Members are typed against the filing site here; a `table()` read is typed by the version's write.
f.validate((declarations) => returnsFault(declarations));
