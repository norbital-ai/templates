import { defineModel, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		job_assignment_id: uuid().notNull(),
		/** The contractor's message as received, separate from the agent's own chat transcript. */
		message: text({ search: true }).notNull(),
		sent_at: instant().notNull(),
		/** Provider-normalized sender identity (for example, a WhatsApp JID or workspace user id). */
		sender: text({ search: true }).notNull(),
		/** Provider message id: retries of the same inbound delivery resolve to the same row. */
		source_message_id: text().notNull()
	},
	{
		description:
			'An immutable inbound field communication attached to a job assignment, retained independently of agent transcripts.',
		recordLabel: 'message',
		icon: 'lucide:message-square-text',
		indexes: [
			{ columns: ['source_message_id'], unique: true },
			{ columns: ['job_assignment_id'] },
			{ columns: ['sent_at'] }
		]
	}
);
