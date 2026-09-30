import { model } from '@norbital-ai/bolt';

/**
 * A message to a customer about their booking. The `deliver_notices` run sends it on WhatsApp to their number, and by
 * email when they gave one, and records where it went.
 */
export default model({
	description: 'A notice to a customer about their booking, and where it was delivered.',
	icon: 'lucide:mail',
	label: 'subject',
	fields: {
		subject: { kind: 'text' },
		body: { kind: 'text' },
		/** The channels the notice was sent on (`whatsapp`, `email`); each send's own delivery shows on its message. */
		delivery: { kind: 'text', optional: true }
	}
});
