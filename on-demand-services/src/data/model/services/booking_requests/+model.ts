import { model } from '../../../../../.norbital/models/booking_requests.ts';
import { AREAS, REPEATS } from '../../../../lib/matching.js';
/** How long a customer's checked times hold before booking must check them again. */
const QUOTE_FRESH_MS = 15 * 60000;
/**
 * A booking asked for on the public portal. The `portal_intake` run books it when a helper is free at the time asked,
 * and otherwise leaves it for the desk to follow up. A request names the times its customer was shown: it is refused
 * when they no longer hold.
 */
export default model({
	description: 'A booking request from the public portal, and what became of it.',
	icon: 'lucide:inbox',
	record_label: 'record.number',
	fields: {
		number: { kind: 'seq', pattern: 'RQ-{yyyy}-{0000}' },
		name: { kind: 'text', max: 200 },
		phone: { kind: 'text', format: 'phone' },
		email: { kind: 'text', format: 'email', optional: true },
		address: { kind: 'text', max: 500 },
		area: { kind: 'enum', values: AREAS, optional: true },
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
		/** Why it was not booked on its own. */
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
		columns: {
			fields: [
				'name',
				'email',
				'phone',
				'address',
				'area',
				'service',
				'start',
				'repeat',
				'notes',
				'availability'
			]
		},
		transform: function* (changes, ctx) {
			const rows = changes.map((c) => c.set);
			const ids = rows.flatMap((r) => r.availability ?? []);
			const quotes =
				ids.length === 0
					? []
					: (yield* ctx.query({ availability_requests: { where: { id: { in: ids } } } }))
							.availability_requests.rows;
			for (const [row, r] of rows.entries()) {
				if (Date.parse(r.start) <= Date.parse(ctx.now))
					return yield* ctx.refuse('Pick a time in the future.', { field: 'start', row });
				if (r.availability === undefined || r.availability === null) continue;
				const q = quotes.find((q) => q.id === r.availability);
				if (
					q === undefined ||
					q.status !== 'ready' ||
					q.phone !== r.phone ||
					q.service !== r.service ||
					q.address !== r.address ||
					q.area !== (r.area ?? null) ||
					q.repeat !== (r.repeat ?? 'once') ||
					!q.starts.includes(r.start) ||
					q.checked_at === null ||
					Date.parse(ctx.now) - Date.parse(q.checked_at) > QUOTE_FRESH_MS
				)
					return yield* ctx.refuse('Availability changed. Check times again.', {
						field: 'start',
						row
					});
			}
			return rows;
		},
		// the writer (a customer) cannot book: `portal_intake` books as dispatch
		effect: function* (changes, ctx) {
			yield* ctx.schedule('portal_intake', { ids: changes.map((c) => c.after.id) });
		}
	},
	update: { columns: { fields: ['status', 'booking', 'outcome'] } }
});
