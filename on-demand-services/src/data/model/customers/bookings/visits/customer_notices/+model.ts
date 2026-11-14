import { model } from '@norbital-ai/bolt';
import { DELIVERY, moves } from '../../../../../../lib/notice-delivery.js';

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
	record_label: 'record.subject',
	fields: {
		customer: { kind: 'ref', to: 'customers', inverse: 'notices' },
		visit: { kind: 'ref', to: 'visits', optional: true, on_delete: 'set_null' },
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
	indexes: { find: { text: ['subject', 'visit'] } },
	outputs: {
		default: {
			fields: 'all',
			customer: { fields: 'all' },
			visit: {
				fields: ['number', 'address'],
				helper: { fields: ['name'] },
				booking: {
					fields: ['number'],
					customer: { fields: ['name', 'phone', 'email', 'address'] },
					service: { fields: ['name'] }
				}
			}
		},
		customer: {
			fields: ['customer', 'visit', 'subject', 'body'],
			customer: { fields: ['name'] },
			visit: {
				fields: ['number', 'address'],
				helper: { fields: ['name'] },
				booking: {
					fields: ['number'],
					customer: { fields: ['name', 'phone', 'email', 'address'] },
					service: { fields: ['name'] }
				}
			}
		}
	},
	create: {
		fields: ['customer', 'visit', 'subject', 'body'],
		transform: function* (changes, ctx) {
			const { rows: customers } = (yield* ctx.query({
				customers: {
					where: { id: { in: changes.map((c) => c.set.customer) } },
					fields: ['email']
				}
			})).customers;
			const email = new Map(customers.map((c) => [c.id, c.email]));
			return changes.map(({ set }) => {
				const to = email.get(set.customer) ?? null;
				return { ...set, to_address: to, delivery: to === null ? null : ('queued' as const) };
			});
		},
		// the desk cannot record delivery: `deliver_notices` sends and records it, as dispatch
		effect: function* (changes, ctx) {
			yield* ctx.schedule('deliver_notices', { ids: changes.map((c) => c.after.id) });
		}
	},
	update: {
		fields: [
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
		],
		// a report that arrives after a later one is stale: it writes nothing
		transform: function* (changes) {
			return changes.map(({ before, set }) =>
				set.delivery == null || moves(before.delivery, set.delivery) ? set : {}
			);
		}
	}
});
