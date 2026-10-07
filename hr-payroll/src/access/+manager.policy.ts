import { policy } from '@norbital-ai/bolt';
import { HR_APPS, MEMBER_LIMITS, SELF, STAFF_READ } from './grants.js';

/** The direct manager: their own self-service, and every record read so leave, claims and attendance can be reviewed. */
export default policy({
	description:
		'Self-service plus read access across people, time, entries and payroll for reviewing approvals.',
	capabilities: { apps: [...HR_APPS] },
	grants: {
		...STAFF_READ,
		...SELF,
		employment_profile: { read: true },
		employment_contract: { read: true }
	},
	limits: MEMBER_LIMITS
});
