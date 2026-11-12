import { policy } from '@norbital-ai/bolt';

/** What the daily agent holds: read the book, write the research on each line and the day's report. */
export default policy({
	description: 'The daily portfolio agent: read the book, write the research and the report.',
	grants: {
		holding: { outputs: { default: {} }, update: {} },
		report: { outputs: { default: {} }, create: {}, update: {} }
	}
});
