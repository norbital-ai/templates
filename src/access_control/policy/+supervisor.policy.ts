import { policy } from '@norbital-ai/bolt';
import {
	MEMBER_LIMITS,
	SELF,
	ROSTER_ENTRY_ATTENDANCE_FIELDS,
	rosterCreateCheck,
	rosterUnpinnedUpdateCheck
} from './grants.js';

/** Self-service, plus the shift's attendance: a supervisor records the clock, reviewed by the direct manager. */
export default policy({
	description:
		'Self-service plus recording attendance for the shift, reviewed by the direct manager.',
	capabilities: { apps: ['hr_employee', 'hr_controller/people'] },
	grants: {
		...SELF,
		employment_profile: { read: true },
		employment_contract: { read: true },
		roster: { read: true },
		roster_entry: {
			read: true,
			create: {
				columns: { roster_entry: ROSTER_ENTRY_ATTENDANCE_FIELDS },
				check: rosterCreateCheck
			},
			update: {
				columns: { roster_entry: ['worked_intervals', 'worksite'] },
				check: rosterUnpinnedUpdateCheck
			}
		}
	},
	limits: MEMBER_LIMITS
});
