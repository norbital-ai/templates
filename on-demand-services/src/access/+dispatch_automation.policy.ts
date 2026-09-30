import { policy } from '@norbital-ai/bolt';

/**
 * The dispatch runs: read the roster and the schedule, re-dispatch visits, file warnings and their letters, notify
 * customers, and book portal requests (filing a new customer) through the same `bookings.book` as the desk.
 */
export default policy({
	description:
		'The dispatch runs: re-dispatch visits, file warnings and their letters, notify customers, and book portal requests.',
	grants: {
		dispatch_settings: { read: true },
		services: { read: true },
		helpers: { read: true },
		helper_time_off: { read: true },
		customers: { read: true, create: true },
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
					'attention'
				]
			}
		},
		helper_warnings: { read: true, create: true, update: { fields: ['letter'] } },
		customer_notices: { read: true, create: true, update: { fields: ['delivery'] } }
	},
	limits: { act: '600/min', read: '600/min' }
});
