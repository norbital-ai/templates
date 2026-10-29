import { model } from '@norbital-ai/bolt';
/** A message is kept exactly as received: create only, so immutability is structural. */
export default model('communication_logs', {
	description:
		'An immutable inbound field communication attached to a job assignment, retained independently of agent transcripts.',
	icon: 'lucide:message-square-text',
	label: 'message',
	fields: {
		job_assignment_id: { kind: 'ref', to: 'job_assignments', inverse: 'communication_logs' },
		/** The contractor's message as received. */
		message: { kind: 'text' },
		sent_at: { kind: 'instant' },
		/** Provider-normalised sender identity (a WhatsApp JID, a member id); pages show the member's name (`senderName`). */
		sender: { kind: 'text', hidden: true },
		/** Provider message id: retries of one delivery resolve to one row. */
		source_message_id: { kind: 'text', unique: true, hidden: true }
	},
	index: ['sent_at'],
	search: { text: ['message', 'sender'] },
	read: 'all',
	outputs: {
		/** A contractor's view of their job's messages, without the source provenance. */
		contractor: {
			communication_logs: { fields: ['job_assignment_id', 'message', 'sent_at', 'sender'] }
		}
	},
	create: {
		columns: {
			communication_logs: ['job_assignment_id', 'message', 'sent_at', 'sender', 'source_message_id']
		},
		transform: function* (rows, ctx) {
			for (const [row, message] of rows.entries())
				for (const field of ['message', 'sender', 'source_message_id'] as const)
					if (message[field].trim() === '')
						return yield* ctx.refuse(`Communication log ${field} cannot be empty.`, { field, row });
			return rows;
		}
	}
});
