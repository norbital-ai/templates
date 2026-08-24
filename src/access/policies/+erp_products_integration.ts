import type { Policy } from './$types.js';

export default {
	description: 'Imports product reference records explicitly mirrored from ERP.',
	grants: {
		products: {
			read: {},
			create: {},
			update: {}
		}
	}
} satisfies Policy;
