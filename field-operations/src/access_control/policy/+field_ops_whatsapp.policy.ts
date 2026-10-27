import { policy } from '@norbital-ai/bolt';
/**
 * The WhatsApp envoy's authority: read every site (to find the job a message names by its address) and assignment, and
 * bring any one up to date in one update (its status,
 * completion and summary, the photos sent and the messages they came in). A photo is filed only through that update
 * (its `job_assignments.photo_evidence` layer carries the message source), so the assignment's grant alone judges it. A group turn runs under this
 * policy alone (P32), so a group report may update any assignment. It cannot create, delete or reassign an assignment,
 * change the work order, or reach the review models. Its limits bound every turn.
 */
export default policy({
	description:
		'The WhatsApp envoy may read every site and job assignment and update any one: its status, completion and summary, the photos sent and the messages they came in.',
	grants: {
		job_assignments: {
			read: true,
			update: {
				columns: {
					job_assignments: ['status', 'completed_at', 'summary'],
					'job_assignments.photo_evidence': ['photo', 'source'],
					'job_assignments.communication_logs': [
						'message',
						'sent_at',
						'sender',
						'source_message_id'
					]
				}
			}
		},
		sites: { read: true },
		communication_logs: { create: true },
		sys_user: { read: true, fields: ['id', 'name'] }
	},
	limits: {
		act: '60/min',
		'envoys.receive': [
			{ rate: '30/min', per: 'sender' },
			{ rate: '300/min', per: 'subject' }
		]
	}
});
