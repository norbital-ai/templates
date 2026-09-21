import type { Policy } from './$types.js';

/** The job rollup worker's authority: read the assignment it was started for, move its job. */
export default {
	description: 'Carries a job assignment’s progress onto its job and touches nothing else.',
	grants: {
		job_assignments: { read: {} },
		jobs: {
			read: {},
			mutate: { existing: { fields: ['status'] } }
		}
	},
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' }
	}
} satisfies Policy;
