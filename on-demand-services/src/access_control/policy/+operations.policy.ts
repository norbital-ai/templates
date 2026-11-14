import { policy } from '@norbital-ai/bolt';
/** The scheduler: bookings, dispatch and re-dispatch, helper and customer profiles, and the dispatch settings. */
export default policy({
	description:
		'Scheduler: settings, services, customers, bookings and portal requests, visits, helpers and their time off, warnings and customer notices.',
	capabilities: {
		apps: ['scheduler', 'helper'],
		automations: [
			'helpers_offboard',
			'bookings_book',
			'bookings_cancel',
			'visits_reassign',
			'visits_reschedule',
			'visits_cancel',
			'visits_accept_proposal',
			'visits_recommend',
			'visits_rebook',
			'visits_report_unavailable'
		]
	},
	grants: {
		dispatch_settings: { outputs: { default: {} }, create: {}, update: {} },
		services: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		openings: { outputs: { default: {} } },
		drive_times: { outputs: { default: {} } },
		customers: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		helpers: {
			// the helper app's day reads `helper`
			outputs: { default: {}, helper: {} },
			create: {},
			update: { moves: 'all' }
		},
		helper_time_off: { outputs: { default: {} }, create: {}, update: {}, delete: {} },
		booking_requests: { outputs: { default: {} }, update: { moves: 'all' } },
		bookings: { outputs: { default: {} }, create: {}, update: { moves: 'all' } },
		booking_helpers: { outputs: { default: {} } },
		visits: { outputs: { default: {}, helper: {} }, update: { moves: 'all' } },
		helper_warnings: { outputs: { default: {} }, create: {} },
		customer_notices: { outputs: { default: {} }, create: {} },
		sys_user: { outputs: { default: {} } },
		// the WhatsApp account a visit's effect tells its helper through
		sys_integration: { outputs: { default: {} } }
	}
});
