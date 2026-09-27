import { policy } from '@norbital-ai/bolt';
import {
	DRAFT_SETTINGS_ROW,
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
		'Senior management: the full people-operations view, plus creating, running and deleting payroll runs.',
	capabilities: { apps: ['hr_employee'] },
	grants: {
		companies: { read: true, create: true, update: true, delete: true },
		company_facts: { read: true, create: true, update: true, delete: true },
		shift_definitions: { read: true, create: true, update: true, delete: true },
		shift_patterns: { read: true, create: true, update: true, delete: true },
		jurisdiction_settings: {
			read: true,
			create: { approval: SEAL_CREATE_APPROVAL },
			update: { approval: SEAL_UPDATE_APPROVAL },
			// a sealed version is history: never deleted, only voided
			delete: { sealed_at: { isNull: true } }
		},
		statutory_contributions: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		leave_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		claim_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		adhoc_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		allowance_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		loan_catalogue: { read: true, create: true, update: true, delete: DRAFT_SETTINGS_ROW },
		jurisdiction_holidays: {
			read: true,
			create: true,
			update: true,
			delete: true,
			actions: ['import_workbook']
		},
		employees: { read: true, create: true, update: true, delete: true },
		employments: { read: true, create: true, update: true, delete: true },
		employment_terms: { read: true, create: true, update: true, delete: true },
		employment_statutory_facts: { read: true, create: true, update: true, delete: true },
		employment_wage_periods: { read: true, create: true, update: true, delete: true },
		payment_holds: { read: true, create: true, update: true, delete: true },
		work_days: {
			read: true,
			create: { fields: WORK_DAY_FULL_FIELDS, approval: WORK_DAY_CREATE_APPROVAL },
			update: { fields: WORK_DAY_FULL_FIELDS, approval: WORK_DAY_UPDATE_APPROVAL },
			delete: UNPINNED
		},
		rosters: { read: true, create: true, delete: true },
		claim_requests: { read: true, create: true, update: true, delete: UNPINNED },
		adhoc_requests: { read: true, create: true, update: true, delete: UNPINNED },
		loans: { read: true, create: true, update: true, delete: true },
		loan_repayments: { read: true, create: true, update: true, delete: UNPINNED },
		leave_entries: {
			read: true,
			create: { approval: [HR_LEAVE_TIME_OFF] },
			queries: ['leave_balances', 'preview_leave']
		},
		payroll_runs: { read: true, create: true, delete: true },
		payslips: { read: true, update: true, delete: UNPAID_PAYSLIP },
		payslip_wage_periods: { read: true }
	},
	limits: MEMBER_LIMITS
});
