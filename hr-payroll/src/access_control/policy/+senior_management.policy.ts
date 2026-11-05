import { policy } from '@norbital-ai/bolt';
import { READ_ALL, HR_OPERATIONS, CONFIGURATION, PAYROLL_STARTS, MEMBER_LIMITS } from './grants.js';
export default policy({
	description:
		'Authorised HR source, configuration and payroll operations through guarded native workflows.',
	capabilities: { apps: ['hr_controller', 'hr_employee'] },
	grants: { ...READ_ALL, ...HR_OPERATIONS, ...CONFIGURATION },
	automations: PAYROLL_STARTS,
	limits: MEMBER_LIMITS
});
