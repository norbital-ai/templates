import type { Policy } from './$types.js';

export default {
	description: 'Imports dispatched jobs and resolves their authored site references.',
	grants: {
		jobs: {
			read: {},
			create: {},
			update: {}
		},
		sites: {
			read: { fields: ['id', 'site_code'] }
		}
	}
} satisfies Policy;
