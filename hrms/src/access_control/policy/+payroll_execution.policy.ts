import { policy } from '@norbital-ai/bolt';
import { READ_ALL, HR_OPERATIONS, AUTOMATION_LIMITS } from './grants.js';
export default policy({
	description:
		'Canonical payroll, recognition, settlement and draft-lock operations. This policy is held only by declared system automations.',
	grants: {
		...READ_ALL,
		...HR_OPERATIONS,
		payroll_run: {
			outputs: { default: {} },
			create: {},
			update: { moves: 'all' },
			delete: {}
		},
		payslip: { outputs: { default: {} }, create: {} },
		employee_balance: { outputs: { default: {} }, create: {}, update: {} },
		ledger_entry: { outputs: { default: {} }, create: {} }
	},
	limits: AUTOMATION_LIMITS
});
