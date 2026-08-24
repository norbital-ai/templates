import type { Policy } from './$types.js';

export default {
	description: 'Imports account reference records explicitly mirrored from ERP.',
	grants: {
		accounts: {
			read: {},
			create: {},
			update: {}
		}
	}
} satisfies Policy;
