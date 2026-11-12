import { automation } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { whatsappAccount, whatsapp } from '../lib/dispatch.js';
import { deliverNoticeRows } from '../lib/notice-delivery.js';
/**
 * Sends each customer notice through the `whatsapp` connection and records acceptance or refusal. Delivery/read receipts
 * belong to the message timeline. The notice's `mail` sync emails it when the customer has an address.
 */
export default automation({
	description:
		'Sends each customer notice on WhatsApp to the customer’s number and records whether it went.',
	input: { ids: { kind: 'ref', to: 'customer_notices', many: true, min_items: 1 } },
	policies: ['dispatch_automation'],
	run: function* ({ ids }, ctx) {
		const { rows } = (yield* ctx.query({
			customer_notices: {
				where: { id: { in: ids }, whatsapp: { is_null: true } },
				fields: ['revision', 'subject', 'body', 'customer'],
				customer: { fields: ['phone'] }
			}
		})).customer_notices;
		const account = rows.length === 0 ? null : yield* whatsappAccount(ctx);
		yield* deliverNoticeRows(
			// a notice without a customer has nowhere to go
			rows.flatMap(({ customer, ...n }) => (customer === null ? [] : [{ ...n, customer }])),
			(n) =>
				account === null
					? Effect.fail(new Error('no WhatsApp account'))
					: ctx.send(account, {
							to: whatsapp(n.customer.phone),
							text: `${n.subject}\n\n${n.body}`,
							about: { model: 'customer_notices', id: n.id }
						}),
			(set) => ctx.act({ 'customer_notices.update': set })
		);
	}
});
