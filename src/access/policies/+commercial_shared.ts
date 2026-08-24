import type { Policy } from './$types.js';

/** Coordinates shared by sales and procurement, owned once so composition stays unambiguous. */
export default {
	description: 'Shared product catalogue and settlement ledger.',
	grants: {
		products: { read: {} },
		settlements: { read: {}, create: {} }
	}
} satisfies Policy;
