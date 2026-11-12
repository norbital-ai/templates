import { policy, type Actor } from '@norbital-ai/bolt';
/** Their own assignments: the one model where the member appears as a column. */
const OWN = { assignee_user_id: { eq: { var: 'requestor.id' } } } as const;
const OWN_JOB = { job_assignment_id: { is: OWN } } as const;
const memberOf = (actor: Actor) => (actor.kind === 'member' ? actor.id : null);
/**
 * The contractor: the jobs they were assigned and nothing else. Everything is scoped through the assignment's
 * `assignee_user_id`; they read each model's `contractor` output (processing and provenance fields stay private).
 */
export default policy({
	description:
		'Self-scoped access to assigned work, with narrowly fielded mutations and linked evidence.',
	capabilities: { apps: ['field_ops_contractor'] },
	grants: {
		sites: {
			outputs: {
				contractor: {
					where: { job_assignments: { some: OWN } },
					// a site's other jobs are not theirs
					job_assignments: { where: OWN }
				}
			}
		},
		job_assignments: {
			outputs: { contractor: { where: OWN } },
			update: {
				columns: {
					fields: [
						'status',
						'completed_at',
						'amount_charged',
						'location',
						'location_address',
						'summary'
					]
				},
				verdict: function* (changes, ctx) {
					const me = memberOf(ctx.actor);
					const other = changes.findIndex(({ before }) => before.assignee_user_id !== me);
					return other < 0
						? ctx.allow()
						: yield* ctx.refuse('Only the jobs assigned to you can be updated.', { row: other });
				}
			}
		},
		photo_evidence: {
			outputs: { contractor: { where: OWN_JOB } },
			create: {
				columns: { fields: ['job_assignment_id', 'photo'] }
			}
		},
		communication_logs: {
			outputs: { contractor: { where: OWN_JOB } },
			create: true
		}
	},
	limits: { act: '600/min', read: '600/min', agent: '100/h' }
});
