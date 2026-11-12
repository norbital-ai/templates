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
		dispatch_settings: { outputs: { default: true }, create: true, update: true },
		services: { outputs: { default: true }, create: true, update: true, delete: true },
		openings: { outputs: { default: true } },
		drive_times: { outputs: { default: true } },
		customers: { outputs: { default: true }, create: true, update: true, delete: true },
		helpers: {
			// the helper app's day reads `helper`
			outputs: { default: true, helper: true },
			create: true,
			update: { moves: 'all' }
		},
		helper_time_off: { outputs: { default: true }, create: true, update: true, delete: true },
		booking_requests: { outputs: { default: true }, update: { moves: 'all' } },
		bookings: { outputs: { default: true }, create: true, update: { moves: 'all' } },
		booking_helpers: { outputs: { default: true } },
		visits: { outputs: { default: true, helper: true }, update: { moves: 'all' } },
		helper_warnings: { outputs: { default: true }, create: true },
		customer_notices: { outputs: { default: true }, create: true },
		sys_user: { outputs: { default: true } },
		// the WhatsApp account a visit's effect tells its helper through
		sys_integration: { outputs: { default: true } }
	},
	limits: { act: '600/min', read: '600/min', agent: '100/h' }
});
