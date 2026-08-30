import type { Policy } from './$types.js';

/** Write authority for the reports import; `construction_read` owns the shared RFI read grant. */
export default {
	description: 'Imports RFI updates from the declared reports integration.',
	grants: {
		rfis: {
			mutate: {
				new: {},
				existing: {}
			}
		}
	}
} satisfies Policy;
