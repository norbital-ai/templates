import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

export default policy({
	description:
		'Reads entities, their people, contracts and declared facts, payroll runs, payslip totals and withholdings, loans, benefit cases, fact revisions and settings versions, raises the duty instances those versions declare and a reminder for each fact owed before the next run, and closes a reminder once its fact is recorded; never fulfils, waives or deletes a declared duty.',
	grants: {
		companies: { read: true },
		company_facts: { read: true },
		employments: { read: true },
		employees: { read: true },
		employment_terms: { read: true },
		person_facts: { read: true },
		fact_evidence: { read: true },
		reference_rows: { read: true },
		payroll_runs: { read: true },
		payslips: { read: true },
		loans: { read: true },
		loan_repayments: { read: true },
		benefit_cases: { read: true },
		jurisdiction_settings: { read: true },
		obligation_instances: { read: true, create: true, update: true }
	},
	limits: AUTOMATION_LIMITS
});
