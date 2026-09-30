import { model } from '@norbital-ai/bolt';

/**
 * A message to a customer about their booking. The `deliver_notices` run sends it on WhatsApp to their number; when the
 * customer gave an email address, the `customer_mail` channel also mails it and records every step it reports here.
 */
export default model({
	description:
		'A notice to a customer about their booking: its WhatsApp send and, by email, where the mail got to.',
	icon: 'lucide:mail',
	label: 'subject',
	fields: {
		subject: { kind: 'text' },
		body: { kind: 'text' },
		/** The WhatsApp send: `sent`, or why it could not go. Its own delivery (delivered, read) is its message's timeline. */
		whatsapp: { kind: 'text', optional: true },
		/** The customer's email address when the notice was filed; none → no mail. */
		to_address: { kind: 'text', optional: true },
		/**
		 * The mail: queued → sent → (deferred) → delivered → opened → replied, or bounced / failed; the channel's events move
		 * it only forward. `delivered` may be presumed (no bounce within the mailbox's quiet window) and `opened` is approximate.
		 */
		delivery: {
			kind: 'enum',
			values: ['queued', 'sent', 'deferred', 'delivered', 'opened', 'replied', 'bounced', 'failed'],
			optional: true
		},
		/** Why a mail is deferred, bounced or failed, with the server's code (`550 5.1.1 …`). */
		delivery_reason: { kind: 'text', optional: true },
		sent_at: { kind: 'instant', optional: true },
		delivered_at: { kind: 'instant', optional: true },
		/** Delivery was inferred from silence, not confirmed by the recipient's server. */
		delivery_presumed: { kind: 'bool', optional: true },
		opened_at: { kind: 'instant', optional: true },
		replied_at: { kind: 'instant', optional: true },
		reply_excerpt: { kind: 'text', optional: true },
		/** An out-of-office or other automatic answer: kept apart, never the customer's reply. */
		auto_replied_at: { kind: 'instant', optional: true }
	}
});
