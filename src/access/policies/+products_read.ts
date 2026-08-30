import type { Policy } from './$types.js';

/** Sole read owner for the product master shared by both desks and its ERP mirror. */
export default {
	description: 'Reads the product catalogue shared by sales, procurement, and the ERP item import.',
	grants: {
		products: { read: {} }
	}
} satisfies Policy;
