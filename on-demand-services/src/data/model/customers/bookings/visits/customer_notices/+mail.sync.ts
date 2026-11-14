import { sync, type SyncRow } from '@norbital-ai/bolt';
import { moves } from '../../../../../../lib/notice-delivery.js';

/**
 * The notice by email, once, when it is filed for a customer with an address; what the mailbox then reports
 * (sent, deferred while the server retries, delivered or presumed so, opened when tracking is on, bounced or failed
 * with the reason, replied, or an automatic answer kept apart) lands on the notice.
 */
export default sync('customer_notices', 'mail', {
	with: 'email',
	write: function* ({ op, row }, ctx) {
		if (op !== 'create' || row.to_address === null) return null;
		const $id = yield* ctx.send({
			to: [row.to_address],
			subject: row.subject,
			text: row.body,
			thread: row.id
		});
		return { $id };
	},
	read: function* ({ deliveries }) {
		// one row per mail, its reports folded in the order they came
		const mails = new Map<string, SyncRow<'customer_notices'>>();
		for (const d of deliveries) {
			// inbound mail is not a report on a notice
			if (d.kind === 'message') continue;
			const set: SyncRow<'customer_notices'> | null =
				d.kind === 'sent'
					? { delivery: 'sent', sent_at: d.at }
					: d.kind === 'deferred' || d.kind === 'bounced' || d.kind === 'failed'
						? { delivery: d.kind, delivery_reason: d.reason ?? d.code ?? null }
						: d.kind === 'delivered'
							? {
									delivery: 'delivered',
									delivered_at: d.at,
									delivery_presumed: d.presumed === true
								}
							: d.kind === 'opened'
								? { delivery: 'opened', opened_at: d.at }
								: d.kind === 'auto_replied'
									? { auto_replied_at: d.at }
									: d.kind === 'replied'
										? {
												delivery: 'replied',
												replied_at: d.reply.sent_at,
												reply_excerpt: d.reply.text.slice(0, 500)
											}
										: null;
			if (set === null) continue;
			const mail = mails.get(d.message);
			// Equal-time inbox reports may arrive in either order; retain earlier delivery facts beneath the later state.
			mails.set(
				d.message,
				set.delivery != null && !moves(mail?.delivery ?? null, set.delivery)
					? { ...set, ...mail, $id: d.message }
					: { ...mail, ...set, $id: d.message }
			);
		}
		return { rows: [...mails.values()] };
	}
});
