import type { PolicyDecisionApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import { Effect } from 'effect';
import type { Policy } from './$types.js';

const uncheckedAssignment = { suspicion_checked_at: { isNull: true } } as const;
const uncheckedJob = { job_assignment_job: { some: uncheckedAssignment } } as const;
const uncheckedSite = {
	site_jobs: { some: { job_assignment_job: { some: uncheckedAssignment } } }
} as const;
const uncheckedVariation = {
	job_assignment_variations: { some: uncheckedAssignment }
} as const;
const uncheckedEvidence = {
	OR: [
		{ job_assignment_photo_evidence: { some: uncheckedAssignment } },
		{ variation_request_photo_evidence: { some: uncheckedVariation } }
	]
} as const;
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

/** Minimal authority for the hourly static automation identity. */
export default {
	description:
		'Reviews only unchecked assignments, appends immutable suspicion evidence, and marks a completed review checked.',
	grants: {
		job_assignments: {
			read: { where: uncheckedAssignment },
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
		jobs: {
			read: { where: uncheckedJob }
		},
		sites: { read: { where: uncheckedSite } },
		variation_requests: {
			read: { where: uncheckedVariation }
		},
		photo_evidence: {
			read: { where: uncheckedEvidence }
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
