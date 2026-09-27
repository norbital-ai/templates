import { policy } from '@norbital-ai/bolt';
import {
	CLAIM_APPROVAL,
	LEAVE_APPROVAL,
	MEMBER_LIMITS,
	OWN,
	WORK_DAY_ATTENDANCE_FIELDS,
	WORK_DAY_CREATE_APPROVAL,
	WORK_DAY_UPDATE_APPROVAL
} from './grants.js';

export default policy({
	description:
		'First-line supervisor: reads the team, reviews and records their attendance and leave.',
	capabilities: { apps: ['hr_employee'] },
	grants: {
		companies: { read: true },
		company_facts: { read: true },
		shift_definitions: { read: true },
		shift_patterns: { read: true },
		leave_catalogue: { read: true },
		jurisdiction_holidays: { read: true },
		jurisdiction_settings: { read: true },
		statutory_contributions: { read: true },
		employees: { read: true },
		employments: { read: true },
		employment_terms: { read: true },
		employment_statutory_facts: { read: true },
		employment_wage_periods: { read: true },
		payment_holds: { read: true },
		payroll_runs: {
			read: { fields: ['company_id', 'period', 'attendance_from', 'attendance_to'] }
		},
		payslips: { read: OWN },
		work_days: {
			read: true,
			// attendance, never the schedule; every write it admits touches the clock and is reviewed
			create: { fields: WORK_DAY_ATTENDANCE_FIELDS, approval: WORK_DAY_CREATE_APPROVAL },
			update: { fields: WORK_DAY_ATTENDANCE_FIELDS, approval: WORK_DAY_UPDATE_APPROVAL }
		},
		rosters: { read: true },
		leave_entries: {
			read: true,
			create: { where: { activity: { eq: 'TIME_OFF' } }, approval: LEAVE_APPROVAL },
			queries: ['leave_balances', 'preview_leave']
		},
		claim_requests: { read: true, create: { where: OWN, approval: CLAIM_APPROVAL } },
		adhoc_requests: { read: true }
	},
	limits: MEMBER_LIMITS
});
