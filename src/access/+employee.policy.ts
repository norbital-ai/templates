import { policy } from '@norbital-ai/bolt';
import {
	CLAIM_APPROVAL,
	LEAVE_APPROVAL,
	MEMBER_LIMITS,
	OWN,
	OWN_EMPLOYEE,
	OWN_EMPLOYMENT,
	WORK_DAY_ATTENDANCE_FIELDS,
	WORK_DAY_CREATE_APPROVAL,
	WORK_DAY_UPDATE_APPROVAL
} from './grants.js';

/**
 * Self-service. Every personal read is scoped to the member's own employee row by email. A loan is read with its
 * schedule through the loan, not the repayments collection.
 */
export default policy({
	description: 'Employee self-service access to profile, time, requests, loans, and payslips.',
	capabilities: { apps: ['hr_employee'] },
	grants: {
		employees: { read: OWN_EMPLOYEE },
		employments: { read: OWN_EMPLOYMENT },
		employment_terms: { read: OWN },
		employment_statutory_facts: { read: { employee_id: { is: OWN_EMPLOYEE } } },
		person_facts: { read: { employee_id: { is: OWN_EMPLOYEE } } },
		employment_history: { read: { employee_id: { is: OWN_EMPLOYEE } } },
		work_days: {
			read: OWN,
			// their own attendance, never the schedule
			create: {
				where: OWN,
				fields: WORK_DAY_ATTENDANCE_FIELDS,
				approval: WORK_DAY_CREATE_APPROVAL
			},
			update: { where: OWN, fields: ['worked_intervals'], approval: WORK_DAY_UPDATE_APPROVAL }
		},
		// the one thing an ordinary rank raises besides time off: a claim, about themselves
		claim_requests: { read: OWN, create: { where: OWN, approval: CLAIM_APPROVAL } },
		adhoc_requests: { read: OWN },
		loans: { read: OWN },
		leave_entries: {
			read: OWN,
			create: { where: { ...OWN, activity: { eq: 'TIME_OFF' } }, approval: LEAVE_APPROVAL },
			queries: ['leave_balances', 'preview_leave']
		},
		payslips: { read: OWN },
		// Only source identities prove this person's capture lock; no payment figures are exposed.
		payable_tranches: {
			read: {
				where: { settlement: { payslips: { is: OWN } } },
				fields: ['id', 'settlement', 'reference', 'source_kind', 'source_id']
			}
		},
		payment_allocations: {
			read: {
				where: { payable_tranche_id: { is: { settlement: { payslips: { is: OWN } } } } },
				fields: ['id', 'payable_tranche_id']
			}
		},
		// leave pickers need paid-period boundaries of their own entity, without payroll inputs or results
		payroll_runs: {
			read: {
				where: { company_id: { is: { employments: { some: OWN_EMPLOYMENT } } } },
				fields: ['company_id', 'period', 'attendance_from', 'attendance_to']
			}
		},
		companies: { read: true },
		company_facts: { read: true },
		worksites: { read: true },
		jurisdiction_holidays: { read: true },
		shift_definitions: { read: true },
		shift_patterns: { read: true },
		claim_catalogue: { read: true },
		adhoc_catalogue: { read: true },
		allowance_catalogue: { read: true },
		loan_catalogue: { read: true },
		reference_rows: { read: true },
		leave_catalogue: { read: true },
		jurisdiction_settings: { read: true },
		statutory_contributions: { read: true }
	},
	limits: MEMBER_LIMITS
});
