import { model } from '@norbital-ai/bolt';
import { DELIVERY, moves } from '../../../../lib/notice-delivery.js';

/**
 * Outbound notice to a customer about their booking or appointment. Sent on WhatsApp via
 * `deliver_notices` and by email via the `mail` sync whenever the customer has an email address.
 */
export default model('customer_notices', {
	description: 'A customer notice with WhatsApp send status and email delivery tracking.',
	icon: 'lucide:mail',
	record_label: 'record.subject',
	fields: {
		customer: { kind: 'ref', to: 'customers', inverse: 'notices', owned: true },
		appointment: { kind: 'ref', to: 'appointments', optional: true, on_delete: 'set_null' },
		subject: { kind: 'text', max: 300 },
		body: { kind: 'text', max: 4000 },
		whatsapp: { kind: 'text', optional: true },
		to_address: { kind: 'text', optional: true },
		delivery: { kind: 'enum', values: DELIVERY, optional: true },
		delivery_reason: { kind: 'text', optional: true },
		sent_at: { kind: 'instant', optional: true },
		delivered_at: { kind: 'instant', optional: true },
		delivery_presumed: { kind: 'bool', optional: true },
		opened_at: { kind: 'instant', optional: true },
		replied_at: { kind: 'instant', optional: true },
		reply_excerpt: { kind: 'text', optional: true },
		auto_replied_at: { kind: 'instant', optional: true }
	},
	indexes: { find: { text: ['subject', 'appointment'] } },
	outputs: {
		default: {
			fields: 'all',
			customer: { fields: 'all' },
			appointment: {
				fields: ['number', 'address'],
				provider: { fields: ['name'] },
				booking: {
					fields: ['number'],
					customer: { fields: ['name', 'phone', 'email', 'address'] },
					service: { fields: ['name'] }
				}
			}
		},
		customer: {
			fields: ['customer', 'appointment', 'subject', 'body'],
			customer: { fields: ['name'] },
			appointment: {
				fields: ['number', 'address'],
				provider: { fields: ['name'] },
				booking: {
					fields: ['number'],
					customer: { fields: ['name', 'phone', 'email', 'address'] },
					service: { fields: ['name'] }
				}
			}
		}
	},
	create: {
		fields: ['customer', 'appointment', 'subject', 'body'],
		transform: function* (changes, ctx) {
			const ids = [...new Set(changes.map((c) => c.after.customer))];
			const { rows: customers } = (yield* ctx.query({
				customers: {
					as_of: 'act',
					where: { id: { in: ids } },
					fields: ['email'],
					limit: ids.length + 1
				}
			})).customers;
			const email = new Map(customers.map((c) => [c.id, c.email]));
			return changes.map(({ set, after }) => {
				const to = email.get(after.customer) ?? null;
				return { ...set, to_address: to, delivery: to === null ? null : ('queued' as const) };
			});
		},
		effect: function* (changes, ctx) {
			const ids = changes.map((c) => c.after.id).sort();
			yield* ctx.schedule('deliver_notices', { ids }, { key: `deliver-notices:${ids.join(',')}` });
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
		transform: function* (changes) {
			return changes.map(({ before, set }) =>
				set.delivery == null || moves(before.delivery, set.delivery) ? set : {}
			);
		}
	}
});
