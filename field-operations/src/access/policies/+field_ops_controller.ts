import type { Policy } from './$types.js';

/**
 * The controller: full command of the dispatch surface.
 *
 * Every collection, every action, unconditional. Written out one grant per line rather than generated
 * from a loop because a permission set is read far more often than it is written, and a reader should
 * be able to see that `photo_evidence` is deletable here without first evaluating a `flatMap`.
 *
 * Unconditional is the whole difference between the two field-operations policies, and it is now the
 * *only* difference in shape: `job_assignments` carries `assignee_user_id`, so the contractor policy
 * narrows that collection to the requestor and this one does not narrow it at all. One role sees its
 * own assignments; this one sees every assignment. There is no third collection describing who a
 * contractor is, because a contractor is a user whose team holds `field_ops_contractor`.
 *
 * The filename is the policy name: `field_ops_controller`. `access/+teams.ts` names that generated
 * `PolicyName` for both the dispatch team and the combined contractor/controller team, so a rename
 * fails at compile time wherever it is still referenced.
 *
 * `Field Operations Controllers` is instead a **team** and the approval target named by
 * `approvers` in `access/policies/+field_ops_contractor.ts`. Approval checks the person's own team,
 * `teamPath[0]`; renaming the team key without the approval is a compile error because `approvers`
 * consumes the generated `TeamName` union. The app title "Field Operations Controller" is only UI
 * copy. Policy, team, and surface therefore each have one deliberate owner.
 */
export default {
	description:
		'Controller access to dispatch jobs, assignments, sites, and approval records, unconditionally.',
	capabilities: { apps: ['field_ops_controller', 'field_ops_contractor'] },
	grants: [
		{ collection: 'sites', action: 'read' },
		{ collection: 'sites', action: 'create' },
		{ collection: 'sites', action: 'update' },
		{ collection: 'sites', action: 'delete' },

		{ collection: 'jobs', action: 'read' },
		{ collection: 'jobs', action: 'create' },
		{ collection: 'jobs', action: 'update' },
		{ collection: 'jobs', action: 'delete' },

		/**
		 * Suspicion is dispatch's to see and dispatch's to answer.
		 *
		 * No contractor grant exists for this collection anywhere, and that absence is the access
		 * control — a contractor cannot read a log written about their own work, so a log is a note
		 * between controllers rather than an accusation delivered to its subject. `create` is here
		 * because a controller may raise one by hand as well as receive one from the automation.
		 */
		{ collection: 'suspicious_activity_logs', action: 'read' },
		{ collection: 'suspicious_activity_logs', action: 'create' },
		{ collection: 'suspicious_activity_logs', action: 'update' },

		{ collection: 'job_assignments', action: 'read' },
		{ collection: 'job_assignments', action: 'create' },
		{ collection: 'job_assignments', action: 'update' },
		{ collection: 'job_assignments', action: 'delete' },

		{ collection: 'variation_requests', action: 'read' },
		{ collection: 'variation_requests', action: 'create' },
		{ collection: 'variation_requests', action: 'update' },
		{ collection: 'variation_requests', action: 'delete' },

		{ collection: 'photo_evidence', action: 'read' },
		{ collection: 'photo_evidence', action: 'create' },
		{ collection: 'photo_evidence', action: 'update' },
		{ collection: 'photo_evidence', action: 'delete' }
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
