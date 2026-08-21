import type { Policy } from './$types.js';

/**
 * BIM reference matrix administration, opened through its own settings app.
 *
 * Same twelve read grants as the other two construction policies — carried over from the seed
 * unchanged. The matrix is a lookup that only means something against the projects, jobs, and assets
 * that cite it, so the reach is wider than the app's name suggests.
 *
 * None of these three policies grants a write anywhere. Construction's mutations run as admin today;
 * whether that is right is a product question, and answering it inside a port would hide the answer
 * in a diff about file moves.
 */
export default {
	description: 'BIM reference matrix administration.',
	capabilities: { apps: ['construction_settings_reference_matrix'] },
	grants: [
		{ collection: 'projects', action: 'read' },
		{ collection: 'site_locations', action: 'read' },
		{ collection: 'rfis', action: 'read' },
		{ collection: 'defects', action: 'read' },
		{ collection: 'workers', action: 'read' },
		{ collection: 'certification_types', action: 'read' },
		{ collection: 'permits_to_work', action: 'read' },
		{ collection: 'jobs', action: 'read' },
		{ collection: 'job_assignments', action: 'read' },
		{ collection: 'payment_claims', action: 'read' },
		{ collection: 'bim_reference_matrix', action: 'read' },
		{ collection: 'asset_documents', action: 'read' }
	],
	/**
	 * What a holder of this policy may spend.
	 *
	 * Declared here rather than in a workspace-wide file, because a rate limit is only meaningful in
	 * terms of who is spending it: `collections.*` is authenticated and cheap, `agents.turn` is
	 * authenticated and costs money at a model provider. Two classes of person holding two policies
	 * can now be given two budgets for the same command, which one file for everybody could not say.
	 */
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'agents.turn': { window: '1 hour', limit: 100, key: 'subject' }
	}
} satisfies Policy;
