import { policy } from '@norbital-ai/bolt';

/** System background authority for message syncing, AI routing, structured extraction, claim valuation, and daily digests. */
export default policy({
	description:
		'Background automation authority for messaging sync, AI extraction, payment claim drafting, and digests.',
	grants: {
		projects: { outputs: { default: {} } },
		project_files: { outputs: { default: {} } },
		tasks: { outputs: { default: {} }, create: {}, update: {} },
		issues: { outputs: { default: {} }, create: {}, update: {} },
		change_orders: { outputs: { default: {} }, create: {}, update: {} },
		progress_updates: { outputs: { default: {} }, create: {}, update: {} },
		cost_items: { outputs: { default: {} }, update: {} },
		quotes: { outputs: { default: {} } },
		payment_claims: { outputs: { default: {} }, create: {}, update: {} },
		contacts: { outputs: { default: {} } },
		communication_settings: { outputs: { default: {} } },
		project_messages: { outputs: { default: {} }, create: {}, update: {} },
		sys_user: { outputs: { default: {} } },
		sys_conversation: { outputs: { default: {} } },
		sys_message: { outputs: { default: {} } },
		sys_integration: { outputs: { default: {} } }
	}
});
