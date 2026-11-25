import { policy } from '@norbital-ai/bolt';
import {
	READ_ALL,
	HR_OPERATIONS,
	CONFIGURATION,
	PAYROLL_STARTS,
	payrollPaymentReview
} from './grants.js';
export default policy({
	description:
		'Authorised HR source, configuration and payroll operations through guarded native workflows. Creating runs is direct; marking a run PAID requires HR Manager or L1 Management approval.',
	capabilities: { apps: ['hr_controller', 'hr_employee'], automations: PAYROLL_STARTS },
	// a manual balance adjustment on the employee profile: the ledger takes only its own shape
	grants: {
		...READ_ALL,
		...HR_OPERATIONS,
		...CONFIGURATION,
		payroll_run: {
			...HR_OPERATIONS.payroll_run,
			update: {
				moves: 'all',
				verdict: function* (changes, ctx) {
					const paying = changes.some(({ after }) => after.state === 'PAID');
					return paying ? ctx.approve(payrollPaymentReview) : ctx.allow();
				}
			}
		},
		ledger_entry: { outputs: { default: {} }, create: {} }
	}
});
