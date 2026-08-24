import type { Policy } from './$types.js';

export default {
	description: 'Imports supplier reference records explicitly mirrored from ERP.',
	grants: {
		suppliers: {
			read: {},
			create: {},
			update: {}
		}
	}
} satisfies Policy;
