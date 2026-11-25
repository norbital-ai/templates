import { policy } from '@norbital-ai/bolt';

/** Operations staff: scheduling, bookings, dispatch recovery, providers, customers, and configuration. */
export default policy({
	description:
		'Operations: scheduling rules, services, customers, bookings, portal requests, appointments, providers, time off, and notices.',
	capabilities: {
		apps: ['scheduling', 'configuration', 'provider'],
		automations: [
			'providers_deactivate',
			'bookings_book',
			'bookings_cancel',
			'appointments_cancel',
			'appointments_confirm_shift',
			'appointments_decline_shift',
			'appointments_accept_proposal',
			'appointments_recommend',
			'appointments_rebook',
			'appointments_report_unavailable'
		]
	},
	grants: {
		scheduling_settings: { outputs: { default: {} }, create: {}, update: {} },
		services: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		openings: { outputs: { default: {} } },
		drive_times: { outputs: { default: {} } },
		customers: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		providers: {
			outputs: { default: {}, provider: {} },
			create: {},
			update: { moves: 'all' }
		},
		provider_time_off: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		booking_requests: { outputs: { default: {} }, update: { moves: 'all' } },
		bookings: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		booking_providers: { outputs: { default: {} } },
		appointments: { outputs: { default: {}, provider: {} }, update: { moves: 'all' } },
		customer_notices: { outputs: { default: {} }, create: {} },
		sys_user: { outputs: { default: {} } },
		sys_integration: { outputs: { default: {} } }
	}
});
