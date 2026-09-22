import type { PolicyDecisionApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';
import { Effect } from 'effect';
import type { Policy } from './$types.js';

/** A photo or a message the envoy files must hang off an assignment the sender holds. */
const heldBySender = (
	record: Readonly<{ job_assignment_id?: string | null }>,
	api: PolicyDecisionApi<WorkspaceSchema>
) =>
	record.job_assignment_id == null
		? Effect.succeed(false)
		: api.db.job_assignments
				.findFirst({ where: { id: { eq: record.job_assignment_id } } })
				.pipe(Effect.map((assignment) => assignment?.assignee_user_id === api.requestor.id));

/**
 * The WhatsApp envoy's authority: bring an existing assignment up to date, and nothing else.
 *
 * One update carries a report: the status it moves to, the photos the contractor sent and the
 * messages that are this assignment's slice of the conversation. It cannot create or delete an
 * assignment, reassign one, or change the work order, and it cannot reach the private review
 * collections. Reading assignments is what lets it answer a contractor who names a job in their own
 * words instead of an exact reference.
 *
 * The linked account supplies only `subject.id`. Runtime drops its team policies and
 * administrator status, so this remains the ceiling even when the linked person has broader
 * authority in the web app.
 */
export default {
	description:
		'The WhatsApp envoy may read every job assignment and update one the sender holds: its status, completion and summary, the photos the sender sent and the messages they came in.',
	capabilities: { apps: [] },
	grants: {
		job_assignments: {
			read: {},
			mutate: {
				existing: {
					authorize: ({ record }, api) => record.assignee_user_id === api.requestor.id,
					fields: ['status', 'completed_at', 'summary']
				}
			}
		},
		photo_evidence: {
			mutate: {
				new: {
					authorize: ({ record }, api) => heldBySender(record, api),
					fields: ['job_assignment_id', 'photo', 'source']
				}
			}
		},
		communication_logs: {
			mutate: {
				new: {
					authorize: ({ record }, api) => heldBySender(record, api),
					fields: ['job_assignment_id', 'message', 'sent_at', 'sender', 'source_message_id']
				}
			}
		}
	},
	limits: {
		'collections.*': { window: '1 min', limit: 60, key: 'subject' },
		'envoys.receive': [
			{ window: '1 min', limit: 30, key: 'sender' },
			{ window: '1 min', limit: 300, key: 'subject' }
		],
		'envoys.registration': { window: '15 minutes', limit: 1, key: 'sender' }
	}
} satisfies Policy;
