import { DateTime } from 'effect';
import { model } from '@norbital-ai/bolt';
import { REPEATS } from '../../../lib/matching.js';

/** Maximum age of an availability quote before a customer must refresh open times. */
const QUOTE_FRESH = { minutes: 15 };

/**
 * Self-service booking request submitted through the customer portal. Validated against its quote
 * on create; `portal_intake` commits the booking automatically or hands it to operations for follow-up.
 */
export default model('booking_requests', {
	description: 'A self-service booking request from the customer portal and its outcome.',
	icon: 'lucide:inbox',
	record_label: 'record.number',
	fields: {
		number: { kind: 'seq', pattern: 'RQ-{yyyy}-{0000}' },
		name: { kind: 'text', max: 200 },
		phone: { kind: 'text', format: 'phone' },
		email: { kind: 'text', format: 'email', optional: true },
		address: { kind: 'text', max: 500 },
		service: { kind: 'ref', to: 'services', where: { active: { eq: true } } },
		start: { kind: 'instant' },
		repeat: { kind: 'enum', values: REPEATS, default: 'once' },
		notes: { kind: 'text', max: 2000, optional: true },
		availability: { kind: 'ref', to: 'availability_requests', optional: true },
		booking: { kind: 'ref', to: 'bookings', optional: true, on_delete: 'set_null' },
		status: {
			kind: 'state',
			initial: 'received',
			states: {
				received: { to: ['booked', 'follow_up'] },
				follow_up: { to: ['booked', 'closed'] },
				booked: {},
				closed: {}
			}
		},
		outcome: { kind: 'text', optional: true }
	},
	constraints: { settled: { locked: { status: { in: ['booked', 'closed'] } } } },
	indexes: {
		status: { on: ['status'] },
		find: { text: ['phone', 'address'] }
	},
	outputs: {
		default: { fields: 'all', service: { fields: ['name'] } },
		customer: {
			fields: ['number', 'phone', 'service', 'start', 'repeat', 'address', 'status', 'booking']
		}
	},
	create: {
		fields: [
			'name',
			'email',
			'phone',
			'address',
			'service',
			'start',
			'repeat',
			'notes',
			'availability'
		],
		transform: function* (changes, ctx) {
			const ids = changes.flatMap(({ after }) =>
				after.availability == null ? [] : [after.availability]
			);
			const quotes =
				ids.length === 0
					? []
					: (yield* ctx.query({
							availability_requests: {
								as_of: 'act',
								where: { id: { in: ids } },
								limit: ids.length + 1
							}
						})).availability_requests.rows;
			const now = DateTime.makeUnsafe(ctx.now);
			for (const [row, { after: r }] of changes.entries()) {
				if (DateTime.isLessThanOrEqualTo(DateTime.makeUnsafe(r.start), now))
					return yield* ctx.refuse('errors.start_in_past', { field: 'start', row });
				if (r.availability === null) continue;
				const q = quotes.find((item) => item.id === r.availability);
				if (
					q === undefined ||
					q.status !== 'ready' ||
					q.phone !== r.phone ||
					q.service !== r.service ||
					q.address !== r.address ||
					q.repeat !== r.repeat ||
					!q.starts.includes(r.start) ||
					q.checked_at === null ||
					DateTime.isGreaterThan(now, DateTime.add(DateTime.makeUnsafe(q.checked_at), QUOTE_FRESH))
				)
					return yield* ctx.refuse('errors.availability_changed', {
						field: 'start',
						row
					});
			}
			return changes.map(({ set }) => set);
		},
		effect: function* (changes, ctx) {
			const ids = changes.map((c) => c.after.id).sort();
			yield* ctx.schedule('portal_intake', { ids }, { key: `portal-intake:${ids.join(',')}` });
		}
	},
	update: { fields: ['status', 'booking', 'outcome'] }
});
