import { policy } from '@norbital-ai/bolt';
import {
	MEMBER_LIMITS,
	SELF,
	ROSTER_ENTRY_ATTENDANCE_FIELDS,
	ROSTER_ENTRY_CREATE_APPROVAL,
	ROSTER_ENTRY_UPDATE_APPROVAL
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
			create: { fields: ROSTER_ENTRY_ATTENDANCE_FIELDS, approval: ROSTER_ENTRY_CREATE_APPROVAL },
			update: {
				where: { payslip_id: { isNull: true } },
				fields: ['worked_intervals', 'worksite'],
				approval: ROSTER_ENTRY_UPDATE_APPROVAL
			}
		}
	},
	limits: MEMBER_LIMITS
});
