import { policy } from '@norbital-ai/bolt';

/** A viewer: reads the book and the reports, changes nothing. */
export default policy({
	description: 'Read-only access to the holdings and the daily reports.',
	capabilities: { apps: ['portfolio'] },
	grants: {
		holding: { outputs: { default: {} } },
		report: { outputs: { default: {} } }
	}
});
