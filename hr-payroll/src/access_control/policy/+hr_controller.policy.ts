import { policy } from '@norbital-ai/bolt';
import { READ_ALL, HR_OPERATIONS, CONFIGURATION, PAYROLL_STARTS, MEMBER_LIMITS } from './grants.js';
export default policy({
	description:
		'Authorised HR source, configuration and payroll operations through guarded native workflows.',
	capabilities: { apps: ['hr_controller', 'hr_employee'] },
	// a manual balance adjustment on the employee profile: the ledger takes only its own shape
	grants: {
		...READ_ALL,
		...HR_OPERATIONS,
		...CONFIGURATION,
		ledger_entry: { read: true, create: true }
	},
	automations: PAYROLL_STARTS,
	limits: MEMBER_LIMITS
});
