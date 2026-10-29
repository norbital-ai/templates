import { model, type SyncRow } from '@norbital-ai/bolt';
const DELIVERY = [
	'queued',
	'sent',
	'deferred',
	'delivered',
	'opened',
	'replied',
	'bounced',
	'failed'
] as const;
type Delivery = (typeof DELIVERY)[number];
/** queued < sent < deferred < delivered < opened < replied; bounced and failed are final. */
const RANK: { readonly [D in Delivery]: number } = {
	queued: 0,
	sent: 1,
	deferred: 2,
	delivered: 3,
	opened: 4,
	replied: 5,
	bounced: 6,
	failed: 6
};
/** Whether a report of `next` moves a mail standing at `current`: only forward, never past a bounce or failure; a reply always lands. */
const moves = (current: Delivery | null, next: Delivery) =>
	current === null || next === 'replied' || RANK[next] > RANK[current];
/**
 * A message to a customer about their booking. The `deliver_notices` run sends it on WhatsApp to their number; when the
 * customer gave an email address, the `mail` sync sends it from the business mailbox (the `customer_mail` connection)
 * and records here every step the mailbox reports. Append-only: a notice is filed once; afterwards only its sends are
 * recorded. The customer's email address is taken when the notice is filed.
 */
export default model('customer_notices', {
	description:
		'A notice to a customer about their booking: its WhatsApp send and, by email, where the mail got to.',
	icon: 'lucide:mail',
	label: 'subject',
	fields: {
		customer: { kind: 'ref', to: 'customers', inverse: 'notices' },
		visit: { kind: 'ref', to: 'visits', optional: true, onDelete: 'setNull' },
		subject: { kind: 'text' },
		body: { kind: 'text' },
		/** The WhatsApp send: `sent`, or why it could not go. Its own delivery (delivered, read) is its message's timeline. */
		whatsapp: { kind: 'text', optional: true },
		/** The customer's email address when the notice was filed; none → no mail. */
		to_address: { kind: 'text', optional: true },
		/**
		 * The mail: queued → sent → (deferred) → delivered → opened → replied, or bounced / failed; reports move it only
		 * forward. `delivered` may be presumed (no bounce within the mailbox's quiet window) and `opened` is approximate.
		 */
		delivery: { kind: 'enum', values: DELIVERY, optional: true },
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
	},
	search: { text: ['subject', 'visit'] },
	read: {
		customer_notices: { fields: 'all' },
		'customer_notices.customer': { fields: 'all' },
		'customer_notices.visit': { fields: ['number', 'address'] },
		'customer_notices.visit.helper': { fields: ['name'] },
		'customer_notices.visit.booking': { fields: ['number'] },
		'customer_notices.visit.booking.customer': { fields: ['name', 'phone', 'email', 'address'] },
		'customer_notices.visit.booking.service': { fields: ['name'] }
	},
	outputs: {
		customer: {
			customer_notices: { fields: ['customer', 'visit', 'subject', 'body'] },
			'customer_notices.customer': { fields: ['name'] },
			'customer_notices.visit': { fields: ['number', 'address'] },
			'customer_notices.visit.helper': { fields: ['name'] },
			'customer_notices.visit.booking': { fields: ['number'] },
			'customer_notices.visit.booking.customer': { fields: ['name', 'phone', 'email', 'address'] },
			'customer_notices.visit.booking.service': { fields: ['name'] }
		}
	},
	create: {
		columns: { customer_notices: ['customer', 'visit', 'subject', 'body'] },
		transform: function* (rows, ctx) {
			const { rows: customers } = (yield* ctx.db.query({
				customers: { where: { id: { in: rows.map((r) => r.customer) } }, fields: ['email'] }
			})).customers;
			const email = new Map(customers.map((c) => [c.id, c.email]));
			return rows.map((r) => {
				const to = email.get(r.customer) ?? null;
				return { ...r, to_address: to, delivery: to === null ? null : ('queued' as const) };
			});
		}
	},
	update: {
		columns: {
			customer_notices: [
				'whatsapp',
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
		},
		// a report that arrives after a later one is stale: it writes nothing
		transform: function* (changes) {
			return changes.map(({ before, set }) =>
				set.delivery == null || moves(before.delivery, set.delivery) ? set : {}
			);
		}
	},
	syncs: {
		/**
		 * The notice by email, once, when it is filed for a customer with an address; what the mailbox then reports
		 * (sent, deferred while the server retries, delivered or presumed so, opened when tracking is on, bounced or failed
		 * with the reason, replied, or an automatic answer kept apart) lands on the notice.
		 */
		mail: {
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
														replied_at: d.reply.sentAt,
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
		}
	},
	// the desk cannot record delivery: `deliver_notices` sends and records it, as dispatch
	effect: {
		created: function* (rows, ctx) {
			yield* ctx.schedule('deliver_notices', { ids: rows.map((r) => r.id) });
		}
	}
});
