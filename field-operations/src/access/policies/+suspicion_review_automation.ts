import type { PolicyDecisionApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import { Effect } from 'effect';
import type { Policy } from './$types.js';

const uncheckedAssignment = { suspicion_checked_at: { isNull: true } } as const;
const uncheckedCommunication = {
	job_assignment_communications: { some: uncheckedAssignment }
} as const;
const uncheckedSuspicionLog = {
	job_assignment_suspicions: { some: uncheckedAssignment }
} as const;
const uncheckedSuspicionReview = {
	job_assignment_suspicion_reviews: { some: uncheckedAssignment }
} as const;

const referencesUncheckedAssignment = (
	record: Readonly<{ job_assignment_id: string }>,
	api: PolicyDecisionApi<WorkspaceSchema>
) =>
	api.db.job_assignments
		.findFirst({ where: { id: { eq: record.job_assignment_id } } })
		.pipe(Effect.map((assignment) => assignment !== undefined));

/**
 * Minimal authority for the hourly static automation identity.
 *
 * The run's first pass inspects every photo still awaiting facts, and that is what the wider reads
 * are for: the photo's own assignment and site (which may belong to an assignment already
 * reviewed), the variation a photo can hang off, and the whole photo corpus the duplicate match
 * probes. The worklist stays narrow in code — only unchecked assignments are judged, and only an
 * uninspected photo is written — while the mutation grants remain scoped to a single transition
 * each.
 */
export default {
	description:
		'Inspects filed photos awaiting facts, reviews unchecked assignments, appends immutable suspicion evidence, and marks a completed review checked.',
	grants: {
		job_assignments: {
			read: {},
			mutate: {
				existing: {
					fields: ['suspicion_checked_at'],
					authorize: ({ previous, changes, record }) =>
						previous.suspicion_checked_at === null &&
						changes.suspicion_checked_at != null &&
						record.suspicion_checked_at != null
				}
			}
		},
		sites: { read: {} },
		variation_requests: { read: {} },
		photo_evidence: {
			read: {},
			mutate: {
				existing: {
					fields: ['sha256', 'perceptual_embedding', 'flags', 'matched_evidence_ids'],
					authorize: ({ previous }) => previous.sha256 === ''
				}
			}
		},
		communication_logs: {
			read: { where: uncheckedCommunication }
		},
		suspicious_activity_logs: {
			read: { where: uncheckedSuspicionLog },
			mutate: {
				new: {
					fields: ['job_assignment_id', 'origin', 'basis', 'review_id', 'evidence_id', 'reason'],
					authorize: ({ record }, api) =>
						record.origin === 'automation' && referencesUncheckedAssignment(record, api)
				}
			}
		},
		suspicion_reviews: {
			read: { where: uncheckedSuspicionReview },
			mutate: {
				new: {
					fields: [
						'job_assignment_id',
						'basis_hash',
						'basis',
						'suspicious',
						'reason',
						'evidence_id',
						'model',
						'reviewed_at',
						'source_key'
					],
					authorize: ({ record }, api) => referencesUncheckedAssignment(record, api)
				}
			}
		}
	},
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'agents.turn': { window: '1 hour', limit: 500, key: 'subject' }
	}
} satisfies Policy;
