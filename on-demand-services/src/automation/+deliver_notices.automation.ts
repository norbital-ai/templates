import { automation } from '@norbital-ai/bolt';
import { whatsapp } from '../lib/dispatch.js';
import { deliverNoticeRows } from '../lib/notice-delivery.js';
/**
 * Sends each customer notice through the `whatsapp` connection and records acceptance or refusal. Delivery/read receipts
 * belong to the message timeline. The notice's `mail` sync emails it when the customer has an address.
 */
export default automation('deliver_notices', {
	description:
		'Sends each customer notice on WhatsApp to the customer’s number and records whether it went.',
	on: { created: 'customer_notices' },
	runAs: ['dispatch_automation'],
	run: function* ({ ids }, ctx) {
		const { rows } = yield* ctx.query('customer_notices', {
			where: { id: { in: ids }, whatsapp: { isNull: true } },
			select: { subject: true, body: true, customer: { select: { phone: true } } },
			all: true
		});
		yield* deliverNoticeRows(
			rows,
			(n) =>
				ctx.send('whatsapp', {
					to: whatsapp(n.customer.phone),
					text: `${n.subject}\n\n${n.body}`,
					about: { collection: 'customer_notices', id: n.id }
				}),
			(set) => ctx.act('customer_notices.update', set)
		);
	}
});
