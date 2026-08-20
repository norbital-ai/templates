import type { Policy } from './$types.js';

/** The approval shape, taken from the grant that holds it so there is nothing to keep in step. */
type Approval = NonNullable<Policy['grants'][number]['approval']>;

/**
 * The contractor: the jobs they were assigned, and nothing else.
 *
 * A contractor is a **user**, not a record. `job_assignments.assignee_user_id` is
 * `bolt_auth_user.norbital_id`, so the assignment collection carries the requestor directly and the
 * self-scope is a column comparison — `ownAssignment` below is an ordinary `where`, not a subquery.
 * Everything else is one hop from an assignment, so each remaining `$sql` reaches the requestor
 * through `job_assignments` alone; the `contractor_profiles` join that used to sit in every one of
 * them is gone along with the collection.
 *
 * There is deliberately no grant on any collection describing the contractor themselves. The person
 * is `bolt_auth_user`, which the runtime's own `bolt.system-collections` policy already grants to any
 * authenticated subject, masked to an id and a name. A workspace collection restating that was the
 * thing this policy used to have to subquery through, and the reason the contractor app could report
 * a lookup failure as "Could not load your contractor profile" — there is now no profile to load.
 *
 * `${requestor.norbital_id}` is **not** interpolated here: these are single-quoted strings, so the
 * literal token reaches the database, and the policy compiler replaces it with a bound parameter on
 * every request. An unknown path throws rather than binding null, so a renamed scope root fails loudly.
 *
 * Use `$sql`, never `RAW`. `RAW` is a function; a grant is stored as jsonb and round-tripped through
 * the manifest, so the function disappears and the grant lands with empty conditions — which the guard
 * reads as unconditional access to the whole collection. A narrowing that silently inverts into a
 * widening is the worst thing a permission rule can do, so `definePolicy` refuses it outright.
 */

/**
 * Their own assignment rows — the one collection where the requestor appears as a column.
 *
 * This is the whole of the self-scope. Every other condition below is written in terms of it.
 */
const ownAssignment = { assignee_user_id: { eq: '${requestor.norbital_id}' } } as const;

/** Sites reachable through an assignment. */
const assignedSite = {
	$sql:
		'"norbital_id" IN (SELECT j.site_id FROM jobs j ' +
		'JOIN job_assignments a ON a.job_id = j.norbital_id ' +
		'WHERE a.assignee_user_id = ${requestor.norbital_id})'
} as const;

/** Jobs they were assigned. */
const assignedJob = {
	$sql:
		'"norbital_id" IN (SELECT a.job_id FROM job_assignments a ' +
		'WHERE a.assignee_user_id = ${requestor.norbital_id})'
} as const;

/** Variations raised against one of their own assignments. */
const ownVariation = {
	$sql:
		'"job_assignment_id" IN (SELECT a.norbital_id FROM job_assignments a ' +
		'WHERE a.assignee_user_id = ${requestor.norbital_id})'
} as const;

/**
 * Photos hang off exactly one of an assignment or a variation, so both legs are needed; a condition on
 * `job_assignment_id` alone would hide every photo attached to their own variation request.
 */
const ownEvidence = {
	$sql:
		'("job_assignment_id" IN (SELECT a.norbital_id FROM job_assignments a ' +
		'WHERE a.assignee_user_id = ${requestor.norbital_id}) ' +
		'OR "variation_request_id" IN (SELECT variation.norbital_id FROM variation_requests variation ' +
		'WHERE variation.job_assignment_id IN (SELECT a.norbital_id FROM job_assignments a ' +
		'WHERE a.assignee_user_id = ${requestor.norbital_id})))'
} as const;

/**
 * A scope change is a commercial decision, so writing a variation raises a request instead of a row.
 *
 * The ids are carried over from the seeded policy rather than reissued: `approval_config_id` on an
 * existing `approval_request` is resolved by scanning grants for a matching `norbital_id`, so a new id
 * would leave every in-flight and historical request unable to name the flow that produced it.
 *
 * The approver is named by `bolt_team.name`, not by `bolt_team.norbital_id`. A team is a runtime row,
 * so its id exists per tenant and belongs to whichever database seeded it — hardcoding one here put a
 * private identifier in a public template and made the flow unsatisfiable anywhere else, with nothing
 * to say so. Activation reconciles a row for every name a release declares, so the target always
 * exists; whether anybody is *in* it is a membership question and not a deploy-time refusal.
 *
 * The string below is therefore the same string as a key in `src/+teams.ts`, and `approvals.decide`
 * matches it against `subject.team` — the person's one team — case-folded. Change it in one place
 * only and every scope change queues behind a team nobody is in.
 */
const controllerTeam = 'Field Operations Controllers';

function variationApproval(configId: string, stepId: string): Approval {
	return {
		id: configId,
		name: 'Field operations variation approval',
		steps: [
			{
				id: stepId,
				name: 'Field operations controller review',
				approvers: [controllerTeam],
				description: 'Controller verifies scope change and selected photo evidence.'
			}
		]
	};
}

export default {
	name: 'field_ops_contractor',
	description:
		'Self-scoped access to assigned jobs and sites, with field updates on own assignments and linked variation or photo evidence.',
	apps: ['field_ops_contractor'],
	grants: [
		{ collection: 'sites', action: 'read', where: assignedSite },
		{ collection: 'jobs', action: 'read', where: assignedJob },
		{ collection: 'job_assignments', action: 'read', where: ownAssignment },
		{ collection: 'job_assignments', action: 'update', where: ownAssignment },
		{ collection: 'variation_requests', action: 'read', where: ownVariation },
		{
			collection: 'variation_requests',
			action: 'create',
			where: ownVariation,
			approval: variationApproval(
				'019f6f10-0001-7000-8000-000000000003',
				'019f6f10-0001-7000-8000-000000000103'
			)
		},
		{
			collection: 'variation_requests',
			action: 'update',
			where: ownVariation,
			approval: variationApproval(
				'019f6f10-0001-7000-8000-000000000004',
				'019f6f10-0001-7000-8000-000000000104'
			)
		},
		{ collection: 'photo_evidence', action: 'read', where: ownEvidence },
		{ collection: 'photo_evidence', action: 'create', where: ownEvidence }
	]
} satisfies Policy;
