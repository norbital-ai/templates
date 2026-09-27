import { customField } from '@norbital-ai/bolt';
import { catalogueBandsFault } from '../../../lib/datatypes/catalogue_band.js';

const f = customField({
	description:
		'One band of a catalogue row: its condition over the entry context, the amount it settles and its entitlement ceiling. Bands are read in order; the first condition that holds governs.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				when: { kind: 'text' },
				amount: { kind: 'text' },
				limit: { kind: 'custom', of: 'entitlement', optional: true }
			}
		}
	}
});
export default f;
f.validate(catalogueBandsFault);
