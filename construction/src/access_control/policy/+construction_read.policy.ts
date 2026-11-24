import { policy } from '@norbital-ai/bolt';

/** Shared read access across construction operations surfaces. */
export default policy({
	description:
		'Read access across projects, contracts, commercial documents (PO/DO/invoices/claims), tasks, BIM issues, project files, BIM cost estimates, costing matrix, messages, and contacts.',
	capabilities: { apps: ['operations'] },
	grants: {
		projects: { outputs: { default: {} } },
		contracts: { outputs: { default: {} } },
		commercial_documents: { outputs: { default: {} } },
		tasks: { outputs: { default: {} } },
		issues: { outputs: { default: {} } },
		project_files: { outputs: { default: {} } },
		cost_estimates: { outputs: { default: {} } },
		cost_matrix: { outputs: { default: {} } },
		contacts: { outputs: { default: {} } },
		project_messages: { outputs: { default: {} } },
		sys_user: { outputs: { default: {} } }
	}
});
