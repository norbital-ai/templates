import { policy } from '@norbital-ai/bolt';

/**
 * The dispatch runs: read the roster and the schedule, re-dispatch visits, file warnings and their letters, notify
 * customers, publish the portal's open times, cache Google drive times, and book portal requests (filing a new customer) through the same
 * `bookings.book` as the desk.
 */
export default policy({
	description:
		'The dispatch runs: re-dispatch visits, file warnings and their letters, notify customers, and book portal requests.',
	grants: {
		dispatch_settings: { read: true },
		services: { read: true },
		openings: { read: true, create: true, update: true, delete: true },
		drive_times: { read: true, create: true },
		helpers: { read: true },
		helper_time_off: { read: true, create: true },
		customers: { read: true, create: true },
		availability_requests: { read: true, update: true, moves: 'all' },
		booking_requests: {
			read: true,
			update: { fields: ['status', 'booking', 'outcome'] },
			moves: { status: ['received->booked', 'received->follow_up'] }
		},
		bookings: { read: true, create: true, actions: ['book'] },
		visits: {
			read: true,
			update: {
				fields: [
					'helper',
					'shift_check',
					'shift_asked_at',
					'eta_minutes',
					'eta_checked_at',
					'attention',
					'proposed_helper',
					'proposed_slot',
					'unavailable_helper'
				]
			}
		},
		helper_warnings: { read: true, create: true, update: { fields: ['letter'] } },
		customer_notices: { read: true, create: true, update: { fields: ['whatsapp'] } }
	},
	limits: { act: '600/min', read: '600/min' }
});
