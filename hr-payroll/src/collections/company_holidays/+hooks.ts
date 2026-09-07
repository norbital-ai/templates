import { Effect } from 'effect';
import { refuseUnlessDraftOnBoth } from '../../lib/settings_seal.js';
import type { Hooks } from './$types.js';

/**
 * A holiday is a row of one jurisdiction settings version and is sealed with it: once the version
 * is sealed no create, edit or delete reaches its calendar, because the PUBLIC_HOLIDAY day type a
 * paid run priced overtime under cannot be rewritten. A new calendar year is a new version.
 */
export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses any write on a holiday whose jurisdiction settings version is sealed; holidays of a draft may be prepared and edited until the seal.',
				handler: ({ input, existing, api }) =>
					Effect.map(
						refuseUnlessDraftOnBoth(
							api,
							existing?.settings_id,
							input.settings_id,
							`Holiday ${String(input.name ?? existing?.name ?? '')}`
						),
						() => input
					)
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'Refuses deleting a holiday whose jurisdiction settings version is sealed.',
				handler: ({ existing, api }) =>
					refuseUnlessDraftOnBoth(api, existing.settings_id, undefined, `Holiday ${existing.name}`)
			}
		}
	}
} satisfies Hooks;
