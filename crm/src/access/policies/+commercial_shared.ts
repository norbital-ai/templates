import type { Policy } from './$types.js';

/** Settlement authority shared by sales and procurement, owned once for unambiguous composition. */
export default {
	description: 'Shared settlement ledger.',
	grants: {
		settlements: { read: {}, mutate: { new: {} } }
	}
} satisfies Policy;
