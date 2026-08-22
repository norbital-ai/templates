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
 * ## What stays absent, deliberately
 *
 * - **No creates and no deletes.** A phone message may advance work that exists. Raising a variation
 *   request is a decision with an approval flow behind it and belongs in the app, where the
 *   contractor can see what they are committing to.
 * - **No `photo_evidence`.** WhatsApp media filing is not supported, and the envoy `task` directs
 *   uploads to the app. A read grant here would let the agent describe evidence it cannot accept.
 * - **No apps.** The principal never opens a surface.
 * - **No controller-only fields, by construction.** `flags`, `suspect` and the `site_identity_*`
 *   markers live on rows this policy either cannot read or reads only for the caller's own work; the
 *   `task` forbids repeating them either way.
 *
 * One limit is the platform's rather than this file's, and is stated so nobody mistakes the lock for
 * a stronger one: grants are row-level, not column-level, so the `update` below covers every column
 * of a row the caller owns — including the integrity fields. The envoy `task` forbids writing
 * them; a column-level grant is the real fix and does not exist yet.
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

export default {
	description:
		'The WhatsApp envoy: read and update the caller’s own job assignments, and read the jobs and sites behind them. No creates, no deletes, no evidence, no apps.',
	capabilities: { apps: [] },
	grants: [
		{ collection: 'sites', action: 'read', where: assignedSite },
		{ collection: 'jobs', action: 'read', where: assignedJob },
		{ collection: 'job_assignments', action: 'read', where: ownAssignment },
		{ collection: 'job_assignments', action: 'update', where: ownAssignment }
	],
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
