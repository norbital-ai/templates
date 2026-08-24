import { Effect } from 'effect';
import type { Policy } from './$types.js';

/**
 * The WhatsApp envoy's own ceiling: a contractor's assignments, over a phone, and nothing else.
 *
 * The envoy names this policy directly. Runtime mints `envoy:field_ops_whatsapp` with this policy
 * and no team. When a sender's verified number matches a workspace account, only that person's
 * `id` is adopted so `${requestor.id}` can narrow rows; their team policies and
 * administrator status never cross the envoy boundary. Because the declaration is authenticated,
 * an unrecognised number receives registration guidance and no model turn.
 *
 * ## Why there are reads now, when there were none
 *
 * This policy previously granted `job_assignments` `update` and nothing else, on the stated grounds
 * that "there is no requestor identity behind a transport message, and the platform cannot scope
 * grants by conversation or messenger". That premise is no longer true: an envoy turn carries the
 * linked contractor as its requestor, so `${requestor.id}` scopes here
 * exactly as it does in `+field_ops_contractor.ts`.
 *
 * The old shape was also unusable in practice. An agent that may update an assignment but may read
 * nothing cannot find the assignment the caller means, cannot confirm it back to them, and cannot
 * honour its own envoy `task` — "answer only from that contractor's assigned jobs, sites, and
 * dispatch scope" — which requires reading all three. The declaration and the task contradicted each
 * other; scoping the grants is what resolves the contradiction without widening anything: every
 * grant below is narrowed to rows that already belong to the caller.
 *
 * The policy is a positive allowlist. It can read enough operational context to identify existing
 * work, update five progress fields, append the sender's message, and file an attached image against
 * that same assignment. It cannot create, delete, or reassign work; it receives no app surface.
 */

/** The whole of the self-scope, the same expression `+field_ops_contractor.ts` is built on. */
const ownAssignment = { assignee_user_id: { eq: '${requestor.id}' } } as const;

/** Jobs the caller was assigned. */
const assignedJob = {
	$sql:
		'"id" IN (SELECT a.job_id FROM job_assignments a ' +
		'WHERE a.assignee_user_id = ${requestor.id})'
} as const;

/** Sites reachable through one of the caller's own assignments. */
const assignedSite = {
	$sql:
		'"id" IN (SELECT j.site_id FROM jobs j ' +
		'JOIN job_assignments a ON a.job_id = j.id ' +
		'WHERE a.assignee_user_id = ${requestor.id})'
} as const;

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
	'summary'
] as const;
const assignmentUpdateFields = [
	'status',
	'completed_at',
	'location',
	'summary',
	'amount_charged'
] as const;
const communicationCreateFields = [
	'job_assignment_id',
	'message',
	'sent_at',
	'sender',
	'source_message_id'
] as const;
const evidenceCreateFields = ['job_assignment_id', 'photo', 'source'] as const;

export default {
	description:
		'The WhatsApp envoy: read existing assigned work, update its operational progress, and append incoming messages or images. No work creation, deletion, reassignment, or apps.',
	capabilities: { apps: [], envoyHistory: 'this_envoy' },
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
			update: {
				authorize: ({ record }, api) => record.assignee_user_id === api.requestor.id,
				fields: assignmentUpdateFields
			}
		},
		communication_logs: {
			create: {
				authorize: ({ record }, api) =>
					api.db.query.job_assignments
						.findFirst({ where: { id: { eq: record.job_assignment_id } } })
						.pipe(Effect.map((assignment) => assignment !== undefined)),
				fields: communicationCreateFields
			}
		},
		photo_evidence: {
			create: {
				authorize: ({ record }, api) =>
					record.job_assignment_id === null
						? false
						: api.db.query.job_assignments
								.findFirst({ where: { id: { eq: record.job_assignment_id } } })
								.pipe(Effect.map((assignment) => assignment !== undefined)),
				fields: evidenceCreateFields
			}
		}
	},
	/**
	 * What a holder of this policy may spend.
	 *
	 * Declared here rather than in a workspace-wide file, because a rate limit is only meaningful in
	 * terms of who is spending it: `collections.*` is authenticated and cheap, while ingress is
	 * bounded once per outside sender and again for the envoy as a whole. Two classes holding policies
	 * can now be given two budgets for the same command, which one file for everybody could not say.
	 */
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'envoys.receive': [
			{ window: '1 min', limit: 30, key: 'sender' },
			{ window: '1 min', limit: 300, key: 'subject' }
		],
		'envoys.registration': { window: '1 hour', limit: 1, key: 'sender' }
	}
} satisfies Policy;
