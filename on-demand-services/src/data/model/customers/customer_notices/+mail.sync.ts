import { sync, type SyncRow } from '@norbital-ai/bolt';
import { moves } from '../../../../lib/notice-delivery.js';

/**
 * Send each newly filed customer notice by email when the customer has an email address, and fold
 * mailbox delivery lifecycle events back onto the notice row.
 */
export default sync('customer_notices', 'mail', {
	with: 'email',
	policies: ['notice_mail'],
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
		const mails = new Map<string, SyncRow<'customer_notices'>>();
		for (const d of deliveries) {
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
