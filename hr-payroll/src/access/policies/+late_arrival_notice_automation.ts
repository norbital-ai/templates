import type { Policy } from './$types.js';

/**
 * The late-arrival notice's authority, held by no human team.
 *
 * It reads the roster and the clock — people, their shifts, their work days — to find the shifts
 * whose fifteen-minute mark has passed with nobody clocked in, and it reads approved leave so a
 * person on leave is never called late. It writes nothing: the reminder is a notification, and a
 * message is not a collection write.
 */
export default {
	description:
		'Reads employments, shifts, work days and approved leave to remind the production manager when a rostered shift has no clock-in fifteen minutes after its start. It writes nothing.',
	grants: {
		companies: { read: {} },
		jurisdiction_settings: { read: {} },
		shift_definitions: { read: {} },
		work_days: { read: {} },
		employments: { read: {} },
		employees: { read: {} },
		leave_entries: { read: {} }
	},
	limits: { 'collections.*': { window: '1 min', limit: 600, key: 'subject' } }
} satisfies Policy;
