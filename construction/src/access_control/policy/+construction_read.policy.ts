import { policy } from '@norbital-ai/bolt';

/** Shared read access across construction operations and configuration surfaces. */
export default policy({
	description:
		'Read access across projects, BIM files, tasks, issues, changes, progress, BOQ costings, quotes, cashflow claims, messages, and contacts.',
	capabilities: { apps: ['operations'] },
	grants: {
		projects: { outputs: { default: {} } },
		project_files: { outputs: { default: {} } },
		tasks: { outputs: { default: {} } },
		issues: { outputs: { default: {} } },
		change_orders: { outputs: { default: {} } },
		progress_updates: { outputs: { default: {} } },
		cost_items: { outputs: { default: {} } },
		quotes: { outputs: { default: {} } },
		payment_claims: { outputs: { default: {} } },
		contacts: { outputs: { default: {} } },
		project_messages: { outputs: { default: {} } },
		sys_user: { outputs: { default: {} } }
	}
});
