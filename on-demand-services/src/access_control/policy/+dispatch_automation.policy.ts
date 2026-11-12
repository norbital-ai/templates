import { policy } from '@norbital-ai/bolt';
/**
 * The dispatch runs: read the roster and the schedule, re-dispatch visits, file warnings and their letters, notify
 * customers, publish the portal's open times, cache Google drive times, and book portal requests (filing a new customer) through the same
 * `bookings_book` as the desk.
 */
export default policy({
	description:
		'The dispatch runs: re-dispatch visits, file warnings and their letters, notify customers, and book portal requests.',
	grants: {
		dispatch_settings: { outputs: { default: {} } },
		services: { outputs: { default: {} } },
		openings: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		drive_times: { outputs: { default: {} }, create: {} },
		helpers: { outputs: { default: {} } },
		helper_time_off: { outputs: { default: {} }, create: {} },
		customers: { outputs: { default: {} }, create: {} },
		availability_requests: { outputs: { default: {} }, update: { moves: 'all' } },
		booking_requests: {
			outputs: { default: {} },
			update: {
				columns: { fields: ['status', 'booking', 'outcome'] },
				moves: { status: ['received->booked', 'received->follow_up'] }
			}
		},
		bookings: { outputs: { default: {} }, create: {} },
		visits: {
			outputs: { default: {} },
			update: {
				columns: {
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
			}
		},
		helper_warnings: {
			outputs: { default: {} },
			create: {},
			update: { columns: { fields: ['letter'] } }
		},
		customer_notices: {
			outputs: { default: {} },
			create: {},
			update: { columns: { fields: ['whatsapp'] } }
		},
		// the shared WhatsApp and Google Routes accounts the runs send and time drives through
		sys_integration: { outputs: { default: {} } }
	},
	limits: { act: '600/min', read: '600/min' }
});
