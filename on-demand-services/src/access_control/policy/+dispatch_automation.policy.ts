import { policy } from '@norbital-ai/bolt';

/**
 * Automated scheduling and dispatch runs: publish openings, compute portal quotes, intake bookings,
 * cache route drive times, monitor shift checks and ETAs, and deliver customer notices.
 */
export default policy({
	description:
		'Dispatch automations: publish openings, book portal requests, rebalance routes, monitor shifts and ETAs, and deliver notices.',
	grants: {
		scheduling_settings: { outputs: { default: {} } },
		services: { outputs: { default: {} } },
		openings: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		drive_times: { outputs: { default: {} }, create: {} },
		providers: { outputs: { default: {} } },
		provider_time_off: { outputs: { default: {} }, create: {} },
		customers: { outputs: { default: {} }, create: {} },
		availability_requests: { outputs: { default: {} }, update: { moves: 'all' } },
		booking_requests: {
			outputs: { default: {} },
			update: {
				fields: ['status', 'booking', 'outcome'],
				moves: { status: ['received->booked', 'received->follow_up'] }
			}
		},
		bookings: { outputs: { default: {} }, create: {} },
		appointments: {
			outputs: { default: {} },
			update: {
				fields: [
					'provider',
					'shift_check',
					'shift_asked_at',
					'eta_minutes',
					'eta_checked_at',
					'attention',
					'proposed_provider',
					'proposed_slot',
					'unavailable_provider'
				]
			}
		},
		customer_notices: {
			outputs: { default: {} },
			create: {},
			update: { fields: ['whatsapp'] }
		},
		sys_integration: { outputs: { default: {} } }
	}
});
