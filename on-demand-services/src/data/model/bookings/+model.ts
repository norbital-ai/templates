import { model } from '@norbital-ai/bolt';
import { AREAS, REPEATS } from '../../../lib/matching.js';
/**
 * One customer order: a service at an address, once or recurring, with or without preferred helpers. Each occurrence is
 * a visit; the booking holds what they share.
 *
 * `bookings_book` matches every visit before anything is written. With a preference the visits go to
 * the customer's helpers in their order; without one, ranking balances added travel and weekly load, with a small
 * continuity bonus for the previous recurring cleaner.
 */
export default model('bookings', {
	description:
		'A booking: customer, service, address, preference and repeat. Its visits are the occurrences.',
	icon: 'lucide:calendar-check',
	label: 'number',
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
			states: { active: { to: ['cancelled'] }, cancelled: { edit: 'none' } }
		},
		notes: { kind: 'text', optional: true },
		visit_count: { kind: 'count', of: 'visits' }
	},
	index: ['status'],
	read: 'all',
	create: {
		columns: {
			bookings: [
				'customer',
				'service',
				'address',
				'location',
				'area',
				'preference',
				'repeat',
				'notes'
			],
			'bookings.preferred_helpers': ['helper', 'rank'],
			'bookings.visits': ['slot', 'address', 'location', 'area', 'skill', 'helper', 'attention']
		}
	},
	update: { columns: { bookings: ['notes', 'status'] } }
});
