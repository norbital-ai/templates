import type { Policy } from './$types.js';

/**
 * The photo inspection worker's authority, held by no human team.
 *
 * It reads the parent chain a photo's capture point is judged against and writes the integrity
 * facts onto the photo it was started for — once: a photo already carrying a hash was inspected,
 * and correcting a filing is a new row, never a second pass over this one.
 */
export default {
	description:
		'Inspects newly filed photo evidence: reads the photo and its site, writes the hash, embedding, flags and duplicate matches once.',
	grants: {
		photo_evidence: {
			read: {},
			mutate: {
				existing: {
					fields: ['sha256', 'perceptual_embedding', 'flags', 'matched_evidence_ids'],
					authorize: ({ previous }) => previous.sha256 === ''
				}
			}
		},
		variation_requests: { read: {} },
		job_assignments: { read: {} },
		sites: { read: {} }
	},
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' }
	}
} satisfies Policy;
