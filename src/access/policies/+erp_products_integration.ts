import type { Policy } from './$types.js';

export default {
	description: 'Writes product reference records explicitly mirrored from ERP.',
	grants: {
		products: {
			mutate: {
				new: {},
				existing: {}
			}
		}
	}
} satisfies Policy;
