import type { Policy } from './$types.js';

export default {
	description: 'Imports dispatched jobs and resolves their authored site references.',
	grants: {
		job_assignments: {
			read: {},
			mutate: {
				new: {},
				existing: {}
			}
		},
		sites: {
			read: { fields: ['id', 'site_code'] }
		}
	}
} satisfies Policy;
