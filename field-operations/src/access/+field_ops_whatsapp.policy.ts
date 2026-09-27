import { policy } from '@norbital-ai/bolt';

/**
 * The WhatsApp envoy's authority: read every assignment and bring any one up to date in one update (its status,
 * completion and summary, the photos sent and the messages they came in). A group turn runs under this policy alone
 * (P32), so a group report may update any assignment. It cannot create, delete or reassign an assignment, change the
 * work order, or reach the review collections. Its limits bound every turn.
 */
export default policy({
	description:
		'The WhatsApp envoy may read every job assignment and update any one: its status, completion and summary, the photos sent and the messages they came in.',
	grants: {
		job_assignments: {
			read: true,
			update: {
				fields: ['status', 'completed_at', 'summary', 'photo_evidence', 'communication_logs']
			}
		},
		photo_evidence: {
			create: {
				fields: ['job_assignment_id', 'photo', 'source']
			}
		},
		communication_logs: {
			create: {
				fields: ['job_assignment_id', 'message', 'sent_at', 'sender', 'source_message_id']
			}
		},
		sys_user: { read: true, fields: ['id', 'name'] }
	},
	limits: {
		act: '60/min',
		'envoys.receive': [
			{ rate: '30/min', per: 'sender' },
			{ rate: '300/min', per: 'subject' }
		],
		'envoys.registration': { rate: '1/15min', per: 'sender' }
	}
});
