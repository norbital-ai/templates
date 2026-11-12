import { policy } from '@norbital-ai/bolt';

/**
 * What the daily agent holds: read the book and the settings with the account they name, write the research on each
 * line and the day's report with the messages it went out as.
 */
export default policy({
	description:
		'The daily portfolio agent: read the book and the settings, write the research and the report.',
	grants: {
		holding: { outputs: { default: {} }, update: {} },
		report: { outputs: { default: {} }, create: {}, update: {} },
		portfolio_settings: { outputs: { default: {} } },
		sys_integration: { outputs: { default: {} } },
		/** The report keeps the messages it was sent as. */
		sys_message: { outputs: { default: {} } }
	}
});
