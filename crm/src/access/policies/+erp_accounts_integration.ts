import type { Policy } from './$types.js';

export default {
	description: 'Writes account reference records explicitly mirrored from ERP.',
	grants: {
		accounts: {
			mutate: {
				new: {},
				existing: {}
			}
		}
	}
} satisfies Policy;
