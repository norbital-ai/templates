import { policy } from '@norbital-ai/bolt';
import {
	AUTOMATION_LIMITS,
	HR_LEAVE_MANUAL,
	HR_LEAVE_TIME_OFF,
	SEPARATION_APPROVAL
} from './grants.js';

export default policy({
	description:
		'Raises a held ENCASHMENT leave entry for a leaver’s unused encashable balance when a contract closes; the HR Manager approves or rejects it. Reads only what the balance needs.',
	grants: {
		// the settlement stamps, in their own non-held write (OD-20 c): a deferred day, and the raise
		employments: { read: true, update: { fields: ['encashment_due_on', 'encashment_raised_at'] } },
		employees: { read: true },
		companies: { read: true },
		company_facts: { read: true },
		worksites: { read: true },
		payment_holds: { read: true, create: true },
		employment_terms: { read: true },
		jurisdiction_settings: { read: true },
		leave_catalogue: { read: true },
		jurisdiction_holidays: { read: true },
		shift_patterns: { read: true },
		shift_definitions: { read: true },
		work_days: { read: true },
		payroll_runs: { read: true },
		payslips: { read: true },
		leave_entries: { read: true, create: { approval: [HR_LEAVE_TIME_OFF, HR_LEAVE_MANUAL] } },
		statutory_contributions: { read: true },
		employment_statutory_facts: { read: true },
		person_facts: { read: true },
		employment_history: { read: true },
		adhoc_catalogue: { read: true },
		adhoc_requests: { read: true, create: { approval: SEPARATION_APPROVAL } }
	},
	limits: AUTOMATION_LIMITS
});
