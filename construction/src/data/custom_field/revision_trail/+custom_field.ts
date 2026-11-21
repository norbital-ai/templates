import { custom_field } from '@norbital-ai/bolt';

/**
 * Co-located revision trail automatically snapshotted by server transforms on project files and quotes.
 */
export default custom_field({
	description:
		'Chronological revision snapshots with version label, date, reference/total, and summary.',
	shape: {
		kind: 'object',
		many: true,
		fields: {
			version: { kind: 'text' },
			saved_on: { kind: 'text' },
			reference: { kind: 'text', optional: true },
			summary: { kind: 'text', optional: true }
		}
	}
});
