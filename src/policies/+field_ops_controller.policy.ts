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
 * `name` is `Controller` and not `Field Operations Controller`, at the owner's request, and that
 * string is load-bearing: `subjectHasPolicy` matches a policy by `name`, case-folded, against the
 * set a subject's team confers. So the only route to this policy is a key in `src/+teams.ts` naming
 * `Controller` — today `Field Operations Controllers` and `Contractor (Controller)`. Rename it here
 * without renaming it there and the team quietly holds nothing: its members sign in successfully
 * into a workspace with no apps in it. `impersonationTeams` lists real teams now, so the picker
 * follows the same map rather than the policy list.
 *
 * The filename is a second, separate key. `field_ops_controller` is what the generated `PolicyName`
 * union is built from and what `+field_ops_whatsapp.channel.ts` spells its `policy` as; it is *not*
 * what a team names. The two axes coincide in `templates/hr-payroll` and do not coincide here.
 *
 * Three names in this workspace are similar and none of them is this one:
 * `Field Operations Controllers` — plural — is a **team**, matched against `subject.team` by the
 * approval engine and named by `approvers` in `+field_ops_contractor.policy.ts`; renaming it would
 * strand the variation-approval step against a team nobody is in. The app is titled "Field
 * Operations Controller" in the i18n catalogues and in `+field_ops_controller.svelte`; that names a
 * surface. Only the `name` below names this policy.
 */
export default {
	name: 'field_ops_controller',
	description:
		'Controller access to dispatch jobs, assignments, sites, and approval records, unconditionally.',
	apps: ['field_ops_controller', 'field_ops_contractor'],
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
	]
} satisfies Policy;
