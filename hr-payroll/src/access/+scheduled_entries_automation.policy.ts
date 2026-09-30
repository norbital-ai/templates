import { policy } from '@norbital-ai/bolt';
import {
	AUTOMATION_LIMITS,
	HR_LEAVE_MANUAL,
	HR_LEAVE_TIME_OFF,
	SEPARATION_APPROVAL
} from './grants.js';

export default policy({
	description:
		'Raises the scheduled mandatory payments as held requests (ad hoc and leave-year-end ENCASHMENT) for the HR Manager, records each occurrence in the obligation ledger, and fulfils an occurrence once a paid payslip settled it. Reads what the person context and leave balances need; never edits or deletes an entry.',
	grants: {
		companies: { read: true },
		company_facts: { read: true },
		employments: { read: true },
		employees: { read: true },
		employment_terms: { read: true },
		employment_statutory_facts: { read: true },
		employment_history: { read: true },
		person_facts: { read: true },
		statutory_contributions: { read: true },
		benefit_cases: { read: true },
		fact_evidence: { read: true },
		worksites: { read: true },
		jurisdiction_settings: { read: true },
		jurisdiction_holidays: { read: true },
		shift_patterns: { read: true },
		shift_definitions: { read: true },
		work_days: { read: true },
		payroll_runs: { read: true },
		payslips: { read: true },
		adhoc_catalogue: { read: true },
		leave_catalogue: { read: true },
		adhoc_requests: { read: true, create: { approval: SEPARATION_APPROVAL } },
		leave_entries: { read: true, create: { approval: [HR_LEAVE_TIME_OFF, HR_LEAVE_MANUAL] } },
		obligation_instances: {
			read: true,
			create: true,
			update: { fields: ['state', 'fulfilled_on'] }
		}
	},
	limits: AUTOMATION_LIMITS
});
