import type { Policy } from './$types.js';

/**
 * Keeps the external customer identity immutable while allowing the mirrored account state and
 * details to be refreshed: the pull may restate `external_code`, never move it.
 */
export default {
	description: 'Writes account reference records explicitly mirrored from ERP.',
	grants: {
		accounts: {
			mutate: {
				new: {},
				existing: {
					authorize: ({ previous, record }) => record.external_code === previous.external_code
				}
			}
		}
	}
} satisfies Policy;
