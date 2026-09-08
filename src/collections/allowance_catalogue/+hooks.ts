import { Effect } from 'effect';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description: 'Preserve Allowance catalogue rows belonging to sealed settings versions.',
				handler: ({ input, existing, api }) =>
					Effect.as(
						refuseUnlessDraftOnBoth(
							api,
							existing?.settings_id,
							input.settings_id,
							`Allowance ${String(input.code ?? existing?.code ?? '')}`
						),
						input
					)
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuse deleting Allowance catalogue rows belonging to sealed settings versions.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(
						api,
						existing.settings_id,
						undefined,
						`Allowance ${existing.code}`
					)
			}
		}
	}
} satisfies Hooks;
