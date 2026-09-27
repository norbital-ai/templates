import { policy } from '@norbital-ai/bolt';

/** Shared read authority; the app-opening policies carry no collection grants. */
export default policy({
	description: 'Read access shared by every construction surface.',
	grants: {
		projects: { read: true },
		site_locations: { read: true },
		rfis: { read: true },
		defects: { read: true },
		workers: { read: true },
		certification_types: { read: true },
		permits_to_work: { read: true },
		jobs: { read: true },
		job_assignments: { read: true },
		payment_claims: { read: true },
		bim_reference_matrix: { read: true },
		asset_documents: { read: true }
	},
	limits: { act: '600/min', read: '600/min', agent: '100/h' }
});
