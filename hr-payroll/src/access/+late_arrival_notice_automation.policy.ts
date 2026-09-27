import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

export default policy({
	description:
		'Reads employments, shifts, work days and approved leave to remind the production manager when a rostered shift has no clock-in fifteen minutes after its start. It writes nothing.',
	grants: {
		companies: { read: true },
		jurisdiction_settings: { read: true },
		shift_definitions: { read: true },
		work_days: { read: true },
		employments: { read: true },
		employees: { read: true },
		leave_entries: { read: true }
	},
	limits: AUTOMATION_LIMITS
});
