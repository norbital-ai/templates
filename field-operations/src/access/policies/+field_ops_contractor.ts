import { approveBy } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Policy } from './$types.js';

/**
 * The contractor: the jobs they were assigned, and nothing else.
 *
 * A contractor is a **user**, not a record. `job_assignments.assignee_user_id` is
 * `user.id`, so the assignment collection carries the requestor directly and the
 * self-scope is a column comparison — `ownAssignment` below is an ordinary `where`, not a subquery.
 * Everything else reaches that same field through declared one-, two-, or three-table relation
 * paths. The policy compiler derives the SQL, dependency collections, reverse paths, and indexes
 * from those trees together.
 *
 * There is deliberately no grant on any collection describing the contractor themselves. The person
 * is `user`, which the runtime's own `bolt.system-collections` policy already grants to any
 * authenticated subject, masked to an id and a name. A workspace collection restating that was the
 * thing this policy used to have to subquery through, and the reason the contractor app could report
 * a lookup failure as "Could not load your contractor profile" — there is now no profile to load.
 *
 * The subject operand is a closed node rather than a string token. A misspelled relation or field is
 * rejected at plan compilation instead of falling through to an opaque SQL branch.
 */

/**
 * Their own assignment rows — the one collection where the requestor appears as a column.
 *
 * This is the whole of the self-scope. Every other condition below is written in terms of it.
 */
const SUBJECT_ID = { $subject: 'id' } as const;
const ownAssignment = { assignee_user_id: { eq: SUBJECT_ID } } as const;

/** Sites reachable through an assignment. */
const assignedSite = {
	site_jobs: { some: { job_assignment_job: { some: ownAssignment } } }
} as const;

/** Jobs they were assigned. */
const assignedJob = { job_assignment_job: { some: ownAssignment } } as const;

/** Variations raised against one of their own assignments. */
const ownVariation = { job_assignment_variations: { some: ownAssignment } } as const;

/**
 * Photos hang off exactly one of an assignment or a variation, so both legs are needed; a condition on
 * `job_assignment_id` alone would hide every photo attached to their own variation request.
 */
const ownEvidence = {
	OR: [
		{ job_assignment_photo_evidence: { some: ownAssignment } },
		{ variation_request_photo_evidence: { some: ownVariation } }
	]
} as const;

/** Messages retained against one of their own assignments. */
const ownCommunication = { job_assignment_communications: { some: ownAssignment } } as const;

/**
 * Read masks are part of the security boundary, not presentation preferences.
 *
 * A record can carry processing and provenance fields used by dispatch without making those fields
 * contractor data. Keeping the allowlists beside the grants also means a new model field is private
 * until somebody deliberately adds it here.
 */
const siteReadFields = [
	'id',
	'site_code',
	'name',
	'location',
	'client_name',
	'house_type',
	'floor_area_sqm'
] as const;
const jobReadFields = [
	'id',
	'site_id',
	'title',
	'nature',
	'scheduled_for',
	'status',
	'description'
] as const;
const assignmentReadFields = [
	'id',
	'job_id',
	'dispatched_at',
	'status',
	'completed_at',
	'amount_charged',
	'location',
	'summary',
	'search_text'
] as const;
const assignmentExistingMutationFields = [
	'status',
	'completed_at',
	'amount_charged',
	'location',
	'summary'
] as const;
const variationReadFields = [
	'id',
	'job_assignment_id',
	'requested_at',
	'title',
	'description',
	'amount'
] as const;
const variationNewMutationFields = [
	'job_assignment_id',
	'requested_at',
	'title',
	'description',
	'amount'
] as const;
const variationExistingMutationFields = ['title', 'description', 'amount'] as const;
const evidenceReadFields = [
	'id',
	'job_assignment_id',
	'variation_request_id',
	'photo',
	'summary'
] as const;
const evidenceNewMutationFields = ['job_assignment_id', 'variation_request_id', 'photo'] as const;
const communicationReadFields = [
	'id',
	'job_assignment_id',
	'message',
	'sent_at',
	'sender'
] as const;

/**
 * A scope change is a commercial decision, so writing a variation raises a request instead of a row.
 *
 * There are no authored flow or stage ids. Runtime derives them from the policy, collection, action
 * and stage position, so copied UUIDs cannot collide.
 *
 * The approver is named by `team.name`, and the argument to `approveBy` is `TeamName` — generated from
 * `access/+teams.ts`'s own keys — so a misspelling is a compile error rather than an approval nobody
 * could ever decide.
 *
 * A `const` rather than a factory, because both grants want the same flow and sharing one is
 * ordinary TypeScript — there is no framework concept and nothing to name.
 */
const variationApproval = {
	flow: () => approveBy('Field Operations Controllers'),
	superceded_by: []
} as const;

export default {
	description:
		'Self-scoped access to assigned work, with narrowly fielded mutations and linked evidence.',
	capabilities: { apps: ['field_ops_contractor'] },
	grants: {
		sites: {
			read: {
				where: assignedSite,
				fields: siteReadFields
			}
		},
		jobs: {
			read: {
				where: assignedJob,
				fields: jobReadFields
			}
		},
		job_assignments: {
			read: {
				where: ownAssignment,
				fields: assignmentReadFields
			},
			mutate: {
				existing: {
					authorize: ({ record }, api) => record.assignee_user_id === api.requestor.id,
					fields: assignmentExistingMutationFields
				}
			}
		},
		variation_requests: {
			read: {
				where: ownVariation,
				fields: variationReadFields
			},
			mutate: {
				new: {
					authorize: ({ record }, api) =>
						api.db.job_assignments
							.findFirst({ where: { id: { eq: record.job_assignment_id } } })
							.pipe(Effect.map((assignment) => assignment !== undefined)),
					fields: variationNewMutationFields,
					approval: variationApproval
				},
				existing: {
					authorize: ({ record }, api) =>
						api.db.job_assignments
							.findFirst({ where: { id: { eq: record.job_assignment_id } } })
							.pipe(Effect.map((assignment) => assignment !== undefined)),
					fields: variationExistingMutationFields,
					approval: variationApproval
				}
			}
		},
		photo_evidence: {
			read: {
				where: ownEvidence,
				fields: evidenceReadFields
			},
			mutate: {
				new: {
					authorize: ({ record }, api) =>
						Effect.gen(function* () {
							if (record.job_assignment_id !== null) {
								return (
									(yield* api.db.job_assignments.findFirst({
										where: { id: { eq: record.job_assignment_id } }
									})) !== undefined
								);
							}
							if (record.variation_request_id === null) return false;
							return (
								(yield* api.db.variation_requests.findFirst({
									where: { id: { eq: record.variation_request_id } }
								})) !== undefined
							);
						}),
					fields: evidenceNewMutationFields
				}
			}
		},
		communication_logs: {
			read: {
				where: ownCommunication,
				fields: communicationReadFields
			}
		}
	},
	/**
	 * What a holder of this policy may spend.
	 *
	 * Declared here rather than in a workspace-wide file, because a rate limit is only meaningful in
	 * terms of who is spending it: `collections.*` is authenticated and cheap, `agents.turn` is
	 * authenticated and costs money at a model provider. Two classes of person holding two policies
	 * can now be given two budgets for the same command, which one file for everybody could not say.
	 */
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'agents.turn': { window: '1 hour', limit: 100, key: 'subject' }
	}
} satisfies Policy;
