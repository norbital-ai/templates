import { policy } from '@norbital-ai/bolt';

/** Email sync: record mailbox delivery lifecycle events on each customer notice. */
export default policy({
	description: 'Notice mail sync: record delivery status updates from the mailbox.',
	grants: {
		customer_notices: {
			outputs: { default: {} },
			update: {
				fields: [
					'delivery',
					'delivery_reason',
					'sent_at',
					'delivered_at',
					'delivery_presumed',
					'opened_at',
					'replied_at',
					'reply_excerpt',
					'auto_replied_at'
				]
			}
		}
	}
});
