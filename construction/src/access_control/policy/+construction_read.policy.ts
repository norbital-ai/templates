import { policy } from '@norbital-ai/bolt';
/** Shared read authority; the app-opening policies carry no model grants. */
export default policy({
	description: 'Read access shared by every construction surface.',
	grants: {
		projects: { outputs: { default: {} } },
		site_locations: { outputs: { default: {} } },
		rfis: { outputs: { default: {} } },
		defects: { outputs: { default: {} } },
		workers: { outputs: { default: {} } },
		certification_types: { outputs: { default: {} } },
		permits_to_work: { outputs: { default: {} } },
		jobs: { outputs: { default: {} } },
		job_assignments: { outputs: { default: {} } },
		payment_claims: { outputs: { default: {} } },
		bim_reference_matrix: { outputs: { default: {} } },
		asset_documents: { outputs: { default: {} } }
	}
});
