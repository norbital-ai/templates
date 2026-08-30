import { policySql, type PolicyDecisionApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import { Effect } from 'effect';
import type { Policy } from './$types.js';

const uncheckedAssignment = { suspicion_checked_at: { isNull: true } } as const;
const uncheckedJob = policySql(
	'"id" IN (SELECT assignment.job_id FROM job_assignments assignment WHERE assignment.suspicion_checked_at IS NULL)'
);
const uncheckedSite = policySql(
	'"id" IN (SELECT job.site_id FROM jobs job JOIN job_assignments assignment ON assignment.job_id = job.id WHERE assignment.suspicion_checked_at IS NULL)'
);
const uncheckedVariation = policySql(
	'"job_assignment_id" IN (SELECT assignment.id FROM job_assignments assignment WHERE assignment.suspicion_checked_at IS NULL)'
);
const uncheckedEvidence = policySql(
	'("job_assignment_id" IN (SELECT assignment.id FROM job_assignments assignment WHERE assignment.suspicion_checked_at IS NULL) OR "variation_request_id" IN (SELECT variation.id FROM variation_requests variation JOIN job_assignments assignment ON assignment.id = variation.job_assignment_id WHERE assignment.suspicion_checked_at IS NULL))'
);
const uncheckedAssignmentChild = policySql(
	'"job_assignment_id" IN (SELECT assignment.id FROM job_assignments assignment WHERE assignment.suspicion_checked_at IS NULL)'
);

/** Linking collections only; every target collection already has its own generation edge. */
const assignmentScopeDependencies = ['job_assignments'] as const;
const siteScopeDependencies = ['jobs', 'job_assignments'] as const;
const evidenceScopeDependencies = ['job_assignments', 'variation_requests'] as const;

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
			read: { where: uncheckedJob, dependencies: assignmentScopeDependencies }
		},
		sites: { read: { where: uncheckedSite, dependencies: siteScopeDependencies } },
		variation_requests: {
			read: { where: uncheckedVariation, dependencies: assignmentScopeDependencies }
		},
		photo_evidence: {
			read: { where: uncheckedEvidence, dependencies: evidenceScopeDependencies }
		},
		communication_logs: {
			read: { where: uncheckedAssignmentChild, dependencies: assignmentScopeDependencies }
		},
		suspicious_activity_logs: {
			read: { where: uncheckedAssignmentChild, dependencies: assignmentScopeDependencies },
			mutate: {
				new: {
					fields: ['job_assignment_id', 'origin', 'basis', 'review_id', 'evidence_id', 'reason'],
					authorize: ({ record }, api) =>
						record.origin === 'automation' && referencesUncheckedAssignment(record, api)
				}
			}
		},
		suspicion_reviews: {
			read: { where: uncheckedAssignmentChild, dependencies: assignmentScopeDependencies },
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
