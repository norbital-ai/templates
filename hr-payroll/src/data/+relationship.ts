import { relationship } from '@norbital-ai/bolt';

/** Native links between the target collection roles. Original retired links remain in migration fixtures. */
export default relationship({
	'employees.user_id': { to: 'sys_user', optional: true, onDelete: 'setNull' },
	'jurisdiction_settings.cloned_from_id': {
		to: 'jurisdiction_settings',
		inverse: 'clones',
		optional: true,
		onDelete: 'setNull'
	},
	'statutory_contributions.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'statutory_contribution_catalog',
		owned: true
	},
	'leave_catalog.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'leave_catalog',
		owned: true
	},
	'loan_catalog.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'loan_catalog',
		owned: true
	},
	'claim_catalog.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'claim_catalog',
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
	'holidays.company_id': { to: 'entity', inverse: 'holiday' },
	'employee_profiles.employee_id': { to: 'employment_profile', inverse: 'employment_contract' },
	'employee_profiles.company_id': { to: 'entity', inverse: 'employment_contract' },
	'rosters.employment_id': { to: 'employment_contract', inverse: 'rosters' },
	'roster_entries.employment_id': { to: 'employment_contract', inverse: 'roster_entry' },
	'roster_entries.payslip_id': {
		to: 'payslips',
		inverse: 'roster_entry',
		optional: true,
		onDelete: 'setNull'
	},
	'payroll_runs.company_id': { to: 'entity', inverse: 'payroll_run' },
	'payroll_runs.settings_id': { to: 'jurisdiction_settings', inverse: 'payroll_run' },
	'payroll_runs.early_for_id': {
		to: 'payroll_run',
		inverse: 'early_settlements',
		optional: true,
		onDelete: 'setNull'
	},
	'payslips.payroll_run_id': { to: 'payroll_run', inverse: 'payslips', owned: true },
	'payslips.employment_id': { to: 'employment_contract', inverse: 'payslips' },
	'obligations.company_id': {
		to: 'entity',
		inverse: 'obligation',
		owned: true
	},
	'obligations.source_obligation_id': { to: 'obligation', inverse: 'source_dependents', optional: true },
	'obligations.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'obligation_instances'
	},
	'work_catalog.settings_id': { to: 'jurisdiction_settings', inverse: 'work_catalog', owned: true },
 'rule_sets.settings_id': { to: 'jurisdiction_settings', inverse: 'rule_set', owned: true, optional: true },
	'catalogue_entries.company_id': { to: 'entity', inverse: 'catalogue_entries' },
	'catalogue_entries.employment_id': { to: 'employment_contract', inverse: 'catalogue_entries', optional: true },
	'catalogue_entries.payslip_id': { to: 'payslips', inverse: 'catalogue_entries', optional: true, onDelete: 'setNull' }
});
