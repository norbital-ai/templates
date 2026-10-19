import { policy } from '@norbital-ai/bolt';
import { MEMBER_LIMITS, SELF } from './grants.js';

/** Self-service. Every personal read is scoped to the member's own employee row by email. */
export default policy({
	description: 'Employee self-service: own profile, time, leave and claims, loans and payslips.',
	capabilities: { apps: ['hr_employee'] },
	grants: SELF,
	limits: MEMBER_LIMITS
});
