import { Effect } from 'effect';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description: 'Preserve Claim catalogue rows belonging to sealed settings versions.',
				handler: ({ input, existing, api }) =>
					Effect.as(
						refuseUnlessDraftOnBoth(
							api,
							existing?.settings_id,
							input.settings_id,
							`Claim ${String(input.code ?? existing?.code ?? '')}`
						),
						input
					)
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
