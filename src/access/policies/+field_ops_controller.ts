import type { Policy } from './$types.js';

/** System-managed suspicion state is intentionally absent from both masks. */
const assignmentNewMutationFields = [
	'job_id',
	'assignee_user_id',
	'dispatched_at',
	'status',
	'completed_at',
	'amount_charged',
	'location',
	'summary',
	'search_text',
	'source_message_id'
] as const;
const assignmentExistingMutationFields = assignmentNewMutationFields;

/**
 * The controller: full command of the dispatch surface.
 *
 * Operational records grant every applicable action unconditionally. Audit ledgers are append-only:
 * controllers can read and append them, but cannot rewrite or delete received communications or AI
 * decisions. Written out one grant per line rather than generated from a loop because a permission
 * set is read far more often than it is written.
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
		'Controller access to dispatch records, private review records, and immutable communication or AI audit ledgers.',
	capabilities: { apps: ['field_ops_controller', 'field_ops_contractor'] },
	grants: {
		sites: {
			read: {},
			mutate: { new: {}, existing: {} },
			delete: {}
		},
		jobs: {
			read: {},
			mutate: { new: {}, existing: {} },
			delete: {}
		},
		suspicious_activity_logs: {
			read: {},
			mutate: { new: {}, existing: {} }
		},
		job_assignments: {
			read: {},
			mutate: {
				new: { fields: assignmentNewMutationFields },
				existing: { fields: assignmentExistingMutationFields }
			},
			delete: {}
		},
		variation_requests: {
			read: {},
			mutate: { new: {}, existing: {} },
			delete: {}
		},
		photo_evidence: {
			read: {},
			mutate: { new: {}, existing: {} },
			delete: {}
		},
		communication_logs: {
			read: {},
			mutate: { new: {} }
		},
		suspicion_reviews: {
			read: {},
			mutate: { new: {} }
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
