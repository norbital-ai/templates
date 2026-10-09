import { relationship } from '@norbital-ai/bolt';

/** Native links between the collection roles; the folder nesting under `data/model` names the owner. */
export default relationship({
	'employment_profile.user_id': { to: 'sys_user', optional: true, onDelete: 'setNull' },
	'employment_contract.employee_id': { to: 'employment_profile', inverse: 'employment_contract' },
	'employment_contract.company_id': { to: 'entity', inverse: 'employment_contract' },
	'jurisdiction_settings.cloned_from_id': {
		to: 'jurisdiction_settings',
		inverse: 'clones',
		optional: true,
		onDelete: 'setNull'
	},
	'rule_set.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'rule_set',
		owned: true,
		optional: true
	},
	'statutory_contribution_catalog.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'statutory_contribution_catalog',
		owned: true
	},
	'adhoc_catalog.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'adhoc_catalog',
		owned: true
	},
	'allowance_catalog.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'allowance_catalog',
		owned: true
	},
	'claim_catalog.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'claim_catalog',
		owned: true
	},
	'leave_catalog.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'leave_catalog',
		owned: true
	},
	'loan_catalog.settings_id': { to: 'jurisdiction_settings', inverse: 'loan_catalog', owned: true },
	'work_catalog.settings_id': { to: 'jurisdiction_settings', inverse: 'work_catalog', owned: true },
	'suspension_kind.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'suspension_kind',
		owned: true
	},
	'adhoc_catalog_entry.catalog_id': { to: 'adhoc_catalog', inverse: 'entry' },
	'adhoc_catalog_entry.company_id': { to: 'entity', inverse: 'adhoc_catalog_entry' },
	'adhoc_catalog_entry.employment_id': {
		to: 'employment_contract',
		inverse: 'adhoc_catalog_entry',
		optional: true
	},
	'adhoc_catalog_entry.payslip_id': {
		to: 'payslip',
		inverse: 'adhoc_catalog_entry',
		optional: true,
		onDelete: 'setNull'
	},
	'claim_catalog_entry.catalog_id': { to: 'claim_catalog', inverse: 'entry' },
	'claim_catalog_entry.company_id': { to: 'entity', inverse: 'claim_catalog_entry' },
	'claim_catalog_entry.employment_id': {
		to: 'employment_contract',
		inverse: 'claim_catalog_entry',
		optional: true
	},
	'claim_catalog_entry.payslip_id': {
		to: 'payslip',
		inverse: 'claim_catalog_entry',
		optional: true,
		onDelete: 'setNull'
	},
	'leave_catalog_entry.catalog_id': { to: 'leave_catalog', inverse: 'entry' },
	'leave_catalog_entry.company_id': { to: 'entity', inverse: 'leave_catalog_entry' },
	'leave_catalog_entry.employment_id': {
		to: 'employment_contract',
		inverse: 'leave_catalog_entry',
		optional: true
	},
	'leave_catalog_entry.payslip_id': {
		to: 'payslip',
		inverse: 'leave_catalog_entry',
		optional: true,
		onDelete: 'setNull'
	},
	'loan_catalog_entry.catalog_id': { to: 'loan_catalog', inverse: 'entry' },
	'loan_catalog_entry.company_id': { to: 'entity', inverse: 'loan_catalog_entry' },
	'loan_catalog_entry.employment_id': {
		to: 'employment_contract',
		inverse: 'loan_catalog_entry',
		optional: true
	},
	'loan_catalog_entry.payslip_id': {
		to: 'payslip',
		inverse: 'loan_catalog_entry',
		optional: true,
		onDelete: 'setNull'
	},
	'obligation.company_id': { to: 'entity', inverse: 'obligation', owned: true },
	'obligation.settings_id': { to: 'jurisdiction_settings', inverse: 'obligation' },
	'regulatory_task.company_id': { to: 'entity', inverse: 'regulatory_task', owned: true },
	'regulatory_task.settings_id': { to: 'jurisdiction_settings', inverse: 'regulatory_task' },
	'holiday.company_id': { to: 'entity', inverse: 'holiday' },
	'workplace_case.company_id': { to: 'entity', inverse: 'workplace_case', owned: true },
	'work_suspension.company_id': { to: 'entity', inverse: 'work_suspension', owned: true },
	'workplace_case.employment_id': {
		to: 'employment_contract',
		inverse: 'workplace_case',
		optional: true
	},
	'shift_pattern.company_id': { to: 'entity', inverse: 'shift_pattern' },
	'shift_definition.company_id': { to: 'entity', inverse: 'shift_definition' },
	'roster.employment_id': { to: 'employment_contract', inverse: 'roster' },
	'roster_entry.employment_id': { to: 'employment_contract', inverse: 'roster_entry' },
	'roster_entry.shift_definition_id': {
		to: 'shift_definition',
		inverse: 'roster_entry',
		optional: true
	},
	'roster_entry.payslip_id': {
		to: 'payslip',
		inverse: 'roster_entry',
		optional: true,
		onDelete: 'setNull'
	},
	'payroll_run.company_id': { to: 'entity', inverse: 'payroll_run' },
	'payroll_run.settings_id': { to: 'jurisdiction_settings', inverse: 'payroll_run' },
	'payslip.payroll_run_id': { to: 'payroll_run', inverse: 'payslip', owned: true },
	'payslip.employment_id': { to: 'employment_contract', inverse: 'payslip' }
});
