import { model } from '../../../../../../.norbital/models/communication_logs.ts';
/** A message is kept exactly as received: create only, so immutability is structural. */
export default model({
	description:
		'An immutable inbound field communication attached to a job assignment, retained independently of agent transcripts.',
	icon: 'lucide:message-square-text',
	record_label: 'record.message',
	fields: {
		job_assignment_id: { kind: 'ref', to: 'job_assignments', inverse: 'communication_logs' },
		/** The contractor's message as received. */
		message: { kind: 'text' },
		sent_at: { kind: 'instant' },
		/** Provider-normalised sender identity (a WhatsApp JID, a member id); pages show the member's name (`senderName`). */
		sender: { kind: 'text', hidden: true },
		/** Provider message id: retries of one delivery resolve to one row. */
		source_message_id: { kind: 'text', hidden: true }
	},
	constraints: { source_message_id: { unique: ['source_message_id'] } },
	indexes: {
		sent_at: { on: ['sent_at'] },
		search: { text: ['message', 'sender'] }
	},
	outputs: {
		default: { fields: 'all', job_assignment_id: { fields: ['title'] } },
		/** A contractor's view of their job's messages, without the source provenance. */
		contractor: { fields: ['job_assignment_id', 'message', 'sent_at', 'sender'] }
	},
	create: {
		columns: {
			fields: ['job_assignment_id', 'message', 'sent_at', 'sender', 'source_message_id']
		},
		transform: function* (changes, ctx) {
			const rows = changes.map(({ set }) => set);
			for (const [row, message] of rows.entries())
				for (const field of ['message', 'sender', 'source_message_id'] as const)
					if (message[field].trim() === '')
						return yield* ctx.refuse('errors.message_field_empty', { field, row });
			return rows;
		}
	}
});
