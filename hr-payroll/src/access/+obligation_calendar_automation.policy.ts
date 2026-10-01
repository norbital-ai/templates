import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

export default policy({
	description:
		'Reads entities, their contracts, payroll runs, payslip totals and withholdings, loans, benefit cases, fact revisions and settings versions, and raises the duty instances those versions declare; never fulfils, waives or deletes a duty.',
	grants: {
		companies: { read: true },
		company_facts: { read: true },
		employments: { read: true },
		payroll_runs: { read: true },
		payslips: { read: true },
		loans: { read: true },
		loan_repayments: { read: true },
		benefit_cases: { read: true },
		jurisdiction_settings: { read: true },
		obligation_instances: { read: true, create: true }
	},
	limits: AUTOMATION_LIMITS
});
