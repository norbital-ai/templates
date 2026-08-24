import type { Policy } from './$types.js';

export default {
	description: 'Imports RFI updates from the declared reports integration.',
	grants: {
		rfis: {
			read: {},
			create: {},
			update: {}
		}
	}
} satisfies Policy;
