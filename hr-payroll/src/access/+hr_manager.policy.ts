import { policy } from '@norbital-ai/bolt';
import {
	DRAFT_SETTINGS_ROW,
	HR_CONTROLLER_APPS,
	HR_LEAVE_TIME_OFF,
	MEMBER_LIMITS,
	SEAL_CREATE_APPROVAL,
	SEAL_UPDATE_APPROVAL,
	UNPAID_PAYSLIP,
	UNPINNED,
	WORK_DAY_CREATE_APPROVAL,
	WORK_DAY_FULL_FIELDS,
	WORK_DAY_UPDATE_APPROVAL
} from './grants.js';

export default policy({
	description:
		'HR management: everything HR administration covers, plus creating, running and deleting payroll runs.',
	capabilities: { apps: ['hr_employee', ...HR_CONTROLLER_APPS] },
	// the entities app starts the Google holiday import
	automations: ['holiday_import', 'payroll_export'],
	grants: {
		companies: { read: true, create: true, update: true, delete: true },
		company_facts: { read: true, create: true, update: true, delete: true },
		worksites: { read: true, create: true, update: true, delete: true },
		shift_definitions: { read: true, create: true, update: true, delete: true },
		shift_patterns: { read: true, create: true, update: true, delete: true },
		jurisdiction_settings: {
			read: true,
			create: { approval: SEAL_CREATE_APPROVAL },
			update: { approval: SEAL_UPDATE_APPROVAL },
			// a sealed version is history: never deleted, only voided
			delete: { sealed_at: { isNull: true } },
			actions: ['new_settings_version']
		},
		statutory_contributions: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		leave_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		claim_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		adhoc_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		allowance_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		loan_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		reference_rows: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		jurisdiction_holidays: {
			read: true,
			create: true,
			update: true,
			delete: true,
			actions: ['import_workbook']
		},
		employees: {
			read: true,
			create: true,
			update: true,
			delete: true,
			queries: ['kiosk_match'],
			actions: ['kiosk_enroll']
		},
		employments: { read: true, create: true, update: true, delete: true },
		employment_terms: { read: true, create: true, update: true, delete: true },
		fact_evidence: { read: true, create: true, update: true, delete: true },
		employment_statutory_facts: { read: true, create: true, update: true, delete: true },
		person_facts: { read: true, create: true, update: true, delete: true },
		employment_history: { read: true, create: true, update: true, delete: true },
		contribution_statement_months: { read: true, create: true, update: true },
		benefit_cases: {
			read: true,
			create: true,
			update: true,
			queries: ['reconcile', 'credit_candidate', 'assess_cash_evidence']
		},
		benefit_case_movements: { read: true, create: true, update: true },
		benefit_case_plans: { read: true, create: true, queries: ['advance_status'] },
		benefit_case_cutoffs: { read: true, create: true },
		employment_wage_periods: { read: true, create: true, update: true, delete: true },
		presence_periods: { read: true, create: true, update: true, delete: true },
		payment_holds: { read: true, create: true, update: true, delete: true },
		noncontract_settlements: { read: true, create: true },
		work_days: {
			read: true,
			create: { fields: WORK_DAY_FULL_FIELDS, approval: WORK_DAY_CREATE_APPROVAL },
			update: { fields: WORK_DAY_FULL_FIELDS, approval: WORK_DAY_UPDATE_APPROVAL },
			delete: UNPINNED,
			actions: ['kiosk_punch', 'import_month']
		},
		rosters: { read: true, create: true, delete: true },
		claim_requests: { read: true, create: true, update: true, delete: UNPINNED },
		adhoc_requests: { read: true, create: true, update: true, delete: UNPINNED },
		loans: { read: true, create: true, update: true, delete: true },
		loan_repayments: { read: true, create: true, update: true, delete: UNPINNED },
		leave_entries: {
			read: true,
			create: { approval: [HR_LEAVE_TIME_OFF] },
			queries: ['leave_balances', 'leave_balance_report', 'preview_leave']
		},
		payroll_runs: { read: true, create: true, delete: true },
		payslips: { read: true, update: true, delete: UNPAID_PAYSLIP },
		payable_tranches: { read: true },
		payment_events: { read: true, create: true },
		payment_allocations: { read: true },
		payslip_wage_periods: { read: true },
		obligation_instances: { read: true, create: true, update: true }
	},
	limits: MEMBER_LIMITS
});
