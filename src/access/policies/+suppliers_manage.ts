import type { Policy } from './$types.js';

/** Sole owner for the supplier master shared by procurement and its ERP mirror. */
export default {
	description: 'Reads and maintains the supplier master for procurement and the ERP vendor import.',
	grants: {
		suppliers: {
			read: {},
			mutate: {
				new: {},
				existing: {}
			}
		}
	}
} satisfies Policy;
