import { policy } from '@norbital-ai/bolt';

/** The `customer_mail` channel, held by nobody's team: record on a notice where its mail got to. */
export default policy({
	description:
		'The customer mail channel: record delivery, opens, bounces and replies on customer notices.',
	grants: {
		customer_notices: {
			read: true,
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
