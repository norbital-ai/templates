import { automation } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { whatsapp, whatsappAccount } from '../lib/dispatch.js';
import { deliverNoticeRows } from '../lib/notice-delivery.js';

/** Sends customer notices through the workspace WhatsApp connection and records queue admission. */
export default automation({
	description: 'Sends queued customer notices on WhatsApp and records queue admission or failure.',
	input: { ids: { kind: 'ref', to: 'customer_notices', many: true, min_items: 1 } },
	policies: ['dispatch_automation'],
	concurrency: { max: 1 },
	run: function* ({ ids }, ctx) {
		const { rows } = (yield* ctx.query({
			customer_notices: {
				where: { id: { in: ids }, whatsapp: { is_null: true } },
				fields: ['revision', 'subject', 'body', 'customer'],
				limit: ids.length + 1,
				customer: { fields: ['phone'] }
			}
		})).customer_notices;
		const account = rows.length === 0 ? null : yield* whatsappAccount(ctx);
		yield* deliverNoticeRows(
			rows.flatMap(({ customer, ...n }) => (customer === null ? [] : [{ ...n, customer }])),
			(n) =>
				account === null
					? Effect.fail(new Error('no WhatsApp account'))
					: ctx.send(account, {
							to: whatsapp(n.customer.phone),
							text: `${n.subject}\n\n${n.body}`,
							about: { model: 'customer_notices', id: n.id }
						}),
			(set) =>
				ctx.act(
					{ 'customer_notices.update': set },
					{
						key: `notices:${set
							.map((u) =>
								typeof u.target === 'string' ? u.target : `${u.target.id}:${u.target.revision}`
							)
							.sort()
							.join(',')}`
					}
				),
			(refreshIds) =>
				ctx
					.query({
						customer_notices: {
							where: { id: { in: refreshIds } },
							fields: ['revision'],
							limit: refreshIds.length + 1
						}
					})
					.pipe(Effect.map((page) => page.customer_notices.rows))
		);
	}
});
