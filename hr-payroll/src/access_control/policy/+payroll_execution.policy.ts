import { policy } from '@norbital-ai/bolt';
import { READ_ALL, HR_OPERATIONS, AUTOMATION_LIMITS } from './grants.js';
export default policy({
	description:
		'Canonical payroll, recognition, settlement and draft-lock operations. This policy is held only by declared system automations.',
	grants: {
		...READ_ALL,
		...HR_OPERATIONS,
		payroll_run: { read: true, create: true, delete: true },
		payslip: { read: true, create: true, update: true, moves: 'all' },
		employee_balance: { read: true, create: true },
		ledger_entry: { read: true, create: true }
	},
	limits: AUTOMATION_LIMITS
});
