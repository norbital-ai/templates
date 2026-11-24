import { policy } from '@norbital-ai/bolt';

/** Background system authority for WhatsApp/email sync, AI routing/extraction, BIM takeoff pipeline, Autodesk syncs, claim drafting, and daily digests. */
export default policy({
	description:
		'Background automation authority for messaging sync, AI extraction, BIM takeoff pipeline, Autodesk syncs, claim drafting, and digests.',
	grants: {
		projects: { outputs: { default: {} } },
		contracts: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		commercial_documents: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		tasks: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		issues: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		project_files: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		cost_estimates: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		cost_matrix: { outputs: { default: {} } },
		contacts: { outputs: { default: {} } },
		communication_settings: { outputs: { default: {} } },
		project_messages: { outputs: { default: {} }, create: {}, update: {} },
		sys_user: { outputs: { default: {} } },
		sys_conversation: { outputs: { default: {} } },
		sys_message: { outputs: { default: {} } },
		sys_integration: { outputs: { default: {} } }
	}
});
