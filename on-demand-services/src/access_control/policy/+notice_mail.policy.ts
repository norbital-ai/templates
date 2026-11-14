import { policy } from '@norbital-ai/bolt';
/** The `mail` sync: record on each customer notice where its mail got to, as the mailbox reports it. */
export default policy({
	description: 'The notice mail sync: record where each notice’s mail got to.',
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
