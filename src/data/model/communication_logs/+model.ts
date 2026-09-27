import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'An immutable inbound field communication attached to a job assignment, retained independently of agent transcripts.',
	icon: 'lucide:message-square-text',
	label: 'message',
	fields: {
		/** The contractor's message as received. */
		message: { kind: 'text' },
		sent_at: { kind: 'instant' },
		/** Provider-normalised sender identity (a WhatsApp JID, a member id). */
		sender: { kind: 'text' },
		/** Provider message id: retries of one delivery resolve to one row. */
		source_message_id: { kind: 'text', unique: true }
	},
	index: ['sent_at'],
	search: { text: ['message', 'sender'] }
});
