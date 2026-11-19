import { policy } from '@norbital-ai/bolt';

/**
 * What the daily agent holds: read the book, the settings, the subscribers and the envoy's accounts, write the research
 * on each line and the day's report.
 */
export default policy({
	description:
		'The daily portfolio agent: read the book and the settings, write the research and the report.',
	grants: {
		holding: { outputs: { default: {} }, update: {} },
		report: { outputs: { default: {} }, create: {}, update: {} },
		portfolio_settings: { outputs: { default: {} } },
		/** Every subscriber, notified directly. */
		report_subscription: { outputs: { default: {} } },
		/** The accounts an envoy is deployed on: the report goes out through them. */
		sys_integration: { outputs: { default: {} } }
	}
});
