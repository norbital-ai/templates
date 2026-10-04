import { policy } from '@norbital-ai/bolt';

/** The scheduler: bookings, dispatch and re-dispatch, helper and customer profiles, and the dispatch settings. */
export default policy({
	description:
		'Scheduler: settings, services, customers, bookings and portal requests, visits, helpers and their time off, warnings and customer notices.',
	capabilities: { apps: ['scheduler', 'helper'] },
	grants: {
		dispatch_settings: { read: true, create: true, update: true },
		services: { read: true, create: true, update: true, delete: true },
		openings: { read: true },
		drive_times: { read: true },
		customers: { read: true, create: true, update: true, delete: true },
		helpers: {
			read: true,
			create: true,
			update: true,
			moves: 'all',
			queries: ['open_slots'],
			actions: ['offboard']
		},
		helper_time_off: { read: true, create: true, update: true, delete: true },
		booking_requests: { read: true, update: true, moves: 'all' },
		bookings: {
			read: true,
			create: true,
			update: true,
			moves: 'all',
			queries: ['open_slots'],
			actions: ['book', 'cancel']
		},
		booking_helpers: { read: true },
		visits: {
			read: true,
			update: true,
			moves: 'all',
			queries: ['candidates', 'rebooking_slots'],
			actions: [
				'reassign',
				'reschedule',
				'cancel',
				'accept_proposal',
				'recommend',
				'rebook',
				'report_unavailable'
			]
		},
		helper_warnings: { read: true, create: true },
		customer_notices: { read: true, create: true },
		sys_user: { read: true }
	},
	limits: { act: '600/min', read: '600/min', agent: '100/h' }
});
