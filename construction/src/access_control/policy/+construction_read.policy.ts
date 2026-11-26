import { policy } from '@norbital-ai/bolt';

/** Shared read access across construction operations surfaces. */
export default policy({
	description:
		'Read access across projects, contracts, commercial documents (PO/DO/invoices/claims), ad-hoc costs, tasks with their activity (comments, issues, meetings), filed documents, BIM cost estimates, item matrix, messages, and contacts.',
	capabilities: { apps: ['operations'] },
	grants: {
		projects: { outputs: { default: {} } },
		contracts: { outputs: { default: {} } },
		commercial_documents: { outputs: { default: {} } },
		adhoc_costs: { outputs: { default: {} } },
		tasks: { outputs: { default: {} } },
		activities: { outputs: { default: {} } },
		project_files: { outputs: { default: {} } },
		cost_estimates: { outputs: { default: {} } },
		item_matrix: { outputs: { default: {} } },
		asset_mappings: { outputs: { default: {} } },
		contacts: { outputs: { default: {} } },
		project_messages: { outputs: { default: {} } },
		sys_user: { outputs: { default: {} } }
	}
});
