import { admitCatalogueRow } from '../../lib/catalogue_rules.js';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Preserve Claim catalogue rows belonging to sealed settings versions; compile the eligibility expressions and require a named rule behind every special treatment.',
				handler: ({ input, existing, api }) => admitCatalogueRow(api, input, existing, 'Claim')
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Refuse deleting Claim catalogue rows belonging to sealed settings versions.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(api, existing.settings_id, undefined, `Claim ${existing.code}`)
			}
		}
	}
} satisfies Hooks;
