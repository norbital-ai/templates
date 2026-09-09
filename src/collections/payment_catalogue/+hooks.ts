import { admitCatalogueRow } from '../../lib/catalogue_rules.js';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Preserve Payment catalogue rows belonging to sealed settings versions; compile the eligibility expressions and require a named rule behind every special treatment.',
				handler: ({ input, existing, api }) => admitCatalogueRow(api, input, existing, 'Payment')
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuse deleting Payment catalogue rows belonging to sealed settings versions.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(api, existing.settings_id, undefined, `Payment ${existing.code}`)
			}
		}
	}
} satisfies Hooks;
