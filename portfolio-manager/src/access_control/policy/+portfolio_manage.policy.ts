import { policy } from '@norbital-ai/bolt';

/** The portfolio owner: reads every record, maintains the book and the settings, and runs the agent by hand. */
export default policy({
	description:
		'Full access to the book and the reports, and the agent that researches and reports on it.',
	capabilities: { apps: ['portfolio'], automations: ['portfolio_agent'] },
	grants: {
		holding: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		report: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		portfolio_settings: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		sys_integration: { outputs: { default: {} } },
		report_subscription: { outputs: { default: {} }, create: {}, delete: {} },
		/** The users who may be subscribed to the report. */
		sys_user: { outputs: { default: {} } }
	}
});
