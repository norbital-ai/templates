import type { Policy } from './$types.js';

/** Shared read authority; app-opening policies deliberately carry no collection grants. */
export default {
	description: 'Read access shared by every construction surface.',
	grants: {
		projects: { read: {} },
		site_locations: { read: {} },
		rfis: { read: {} },
		defects: { read: {} },
		workers: { read: {} },
		certification_types: { read: {} },
		permits_to_work: { read: {} },
		jobs: { read: {} },
		job_assignments: { read: {} },
		payment_claims: { read: {} },
		bim_reference_matrix: { read: {} },
		asset_documents: { read: {} }
	},
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'agents.turn': { window: '1 hour', limit: 100, key: 'subject' }
	}
} satisfies Policy;
