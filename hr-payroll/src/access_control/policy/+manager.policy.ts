import { policy } from '@norbital-ai/bolt';
import { MEMBER_LIMITS } from './grants.js';
export default policy({
	description:
		'Review native leave and claim approvals and read scheduling evidence. Personal payroll remains under employee or HR authority.',
	capabilities: { apps: ['hr_employee'] },
	grants: {},
	limits: MEMBER_LIMITS
});
