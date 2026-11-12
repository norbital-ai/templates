import { model } from '../../../../../.norbital/models/bookings.ts';
import { AREAS, REPEATS } from '../../../../lib/matching.js';
/**
 * One customer order: a service at an address, once or recurring, with or without preferred helpers. Each occurrence is
 * a visit; the booking holds what they share.
 *
 * `bookings_book` matches every visit before anything is written. With a preference the visits go to
 * the customer's helpers in their order; without one, ranking balances added travel and weekly load, with a small
 * continuity bonus for the previous recurring cleaner.
 */
export default model({
	description:
		'A booking: customer, service, address, preference and repeat. Its visits are the occurrences.',
	icon: 'lucide:calendar-check',
	record_label: 'record.number',
	fields: {
		number: { kind: 'seq', pattern: 'BK-{yyyy}-{0000}' },
		customer: { kind: 'ref', to: 'customers', inverse: 'bookings' },
		service: { kind: 'ref', to: 'services', inverse: 'bookings' },
		address: { kind: 'text' },
		location: { kind: 'point', optional: true },
		area: { kind: 'enum', values: AREAS, optional: true },
		preference: { kind: 'enum', values: ['any', 'preferred'] },
		repeat: { kind: 'enum', values: REPEATS },
		status: {
			kind: 'state',
			initial: 'active',
			states: { active: { to: ['cancelled'] }, cancelled: {} }
		},
		notes: { kind: 'text', optional: true },
		visit_count: { kind: 'count', of: 'visits' }
	},
	constraints: { cancelled: { locked: { status: { eq: 'cancelled' } } } },
	indexes: {
		status: { on: ['status'] },
		find: { text: ['number', 'customer', 'service'] }
	},
	outputs: {
		default: {
			fields: 'all',
			customer: { fields: ['name', 'phone', 'email', 'address'] },
			service: { fields: ['name'] }
		},
		customer: {
			fields: ['number', 'customer', 'service', 'repeat', 'status', 'visit_count'],
			customer: { fields: ['name', 'phone', 'email', 'address'] },
			service: { fields: ['name'] }
		},
		helper: {
			fields: ['number', 'service', 'customer', 'notes'],
			customer: { fields: ['name', 'phone', 'email', 'address'] },
			service: { fields: ['name'] }
		}
	},
	create: {
		columns: {
			fields: [
				'customer',
				'service',
				'address',
				'location',
				'area',
				'preference',
				'repeat',
				'notes'
			],
			preferred_helpers: { fields: ['helper', 'rank'] },
			visits: { fields: ['slot', 'address', 'location', 'area', 'skill', 'helper', 'attention'] }
		},
		// the portal's times and the drive checks are dispatch sweeps; a key coalesces a burst of writes into one run
		effect: function* (_, ctx) {
			yield* ctx.schedule('publish_openings', {}, { key: 'publish_openings' });
			yield* ctx.schedule('check_drives', {}, { key: 'check_drives' });
		}
	},
	update: { columns: { fields: ['notes', 'status'] } }
});
