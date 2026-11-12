import { policy } from '@norbital-ai/bolt';
/** Shared read authority; the app-opening policies carry no model grants. */
export default policy({
	description: 'Read access shared by every construction surface.',
	grants: {
		projects: { outputs: { default: true } },
		site_locations: { outputs: { default: true } },
		rfis: { outputs: { default: true } },
		defects: { outputs: { default: true } },
		workers: { outputs: { default: true } },
		certification_types: { outputs: { default: true } },
		permits_to_work: { outputs: { default: true } },
		jobs: { outputs: { default: true } },
		job_assignments: { outputs: { default: true } },
		payment_claims: { outputs: { default: true } },
		bim_reference_matrix: { outputs: { default: true } },
		asset_documents: { outputs: { default: true } }
	},
	limits: { act: '600/min', read: '600/min', agent: '100/h' }
});
