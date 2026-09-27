import { policy } from '@norbital-ai/bolt';
import {
	ATTENDANCE_ONLY_DAY,
	CLAIM_APPROVAL,
	HR_CONTROLLER_APPS,
	LEAVE_APPROVAL,
	MEMBER_LIMITS,
	OWN,
	WORK_DAY_ATTENDANCE_FIELDS,
	WORK_DAY_CREATE_APPROVAL,
	WORK_DAY_UPDATE_APPROVAL
} from './grants.js';

/**
 * The supervisor's authority across the company, plus deleting attendance-only days. The kiosk and settings calls
 * are granted because a manager reaches their pages today; the writes behind them are refused by the manager's
 * read-only people and settings grants, as today.
 */
export default policy({
	description:
		'Manager: reads people operations across the company and owns their team’s time and leave.',
	capabilities: { apps: ['hr_employee', ...HR_CONTROLLER_APPS] },
	// the entities app starts the Google holiday import
	automations: ['holiday_import'],
	grants: {
		companies: { read: true },
		company_facts: { read: true },
		shift_definitions: { read: true },
		shift_patterns: { read: true },
		leave_catalogue: { read: true },
		jurisdiction_holidays: { read: true },
		jurisdiction_settings: { read: true, actions: ['new_settings_version'] },
		statutory_contributions: { read: true },
		employees: { read: true, queries: ['kiosk_match'], actions: ['kiosk_enroll'] },
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
			create: { fields: WORK_DAY_ATTENDANCE_FIELDS, approval: WORK_DAY_CREATE_APPROVAL },
			update: { fields: WORK_DAY_ATTENDANCE_FIELDS, approval: WORK_DAY_UPDATE_APPROVAL },
			delete: ATTENDANCE_ONLY_DAY,
			actions: ['kiosk_punch', 'import_month']
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
