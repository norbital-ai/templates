import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { admitCatalogueRow } from '../../lib/catalogue_rules.js';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Preserve Payment catalogue rows belonging to sealed settings versions; compile the eligibility expression.',
				handler: ({ input, existing, api }) =>
					Effect.map(admitCatalogueRow(api, input, existing, 'Payment'), (admitted) => {
						const row = { ...existing, ...admitted };
						if (row.source === 'SCHEDULE' && row.schedule == null)
							refuse(
								`Payment ${String(row.code ?? '')} falls due on a schedule, so it states one.`
							);
						return admitted;
					})
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
