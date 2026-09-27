import { customField } from '@norbital-ai/bolt';
import { rosterCodeVariantFault } from '../../../lib/datatypes/roster_code_variant.js';

const f = customField({
	description:
		'A roster code is either a scheduled work window with its unpaid break, a protected rest day, or another planned off day. Public holidays come from the observed holiday calendar.',
	shape: {
		kind: 'union',
		by: 'kind',
		arms: {
			WORK: {
				start_time: { kind: 'text' },
				end_time: { kind: 'text' },
				break_minutes: { kind: 'int', min: 0 }
			},
			REST: { statutory: { kind: 'bool', optional: true } },
			OFF: {}
		}
	}
});
export default f;
f.validate(rosterCodeVariantFault);
