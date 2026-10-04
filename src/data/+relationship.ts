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
		inverse: 'statutory_contributions',
		owned: true
	},
	'leave_catalogue.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'leave_catalogue',
		owned: true
	},
	'loan_catalogue.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'loan_catalogue',
		owned: true
	},
	'claim_catalogue.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'claim_catalogue',
		owned: true
	},
	'adhoc_catalogue.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'adhoc_catalogue',
		owned: true
	},
	'allowance_catalogue.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'allowance_catalogue',
		owned: true
	},
	'holidays.company_id': { to: 'entities', inverse: 'holidays' },
	'employee_profiles.employee_id': { to: 'employees', inverse: 'employee_profiles' },
	'employee_profiles.company_id': { to: 'entities', inverse: 'employee_profiles' },
	'rosters.employment_id': { to: 'employee_profiles', inverse: 'rosters' },
	'roster_entries.employment_id': { to: 'employee_profiles', inverse: 'roster_entries' },
	'roster_entries.payslip_id': {
		to: 'payslips',
		inverse: 'roster_entries',
		optional: true,
		onDelete: 'setNull'
	},
	'payroll_runs.company_id': { to: 'entities', inverse: 'payroll_runs' },
	'payroll_runs.settings_id': { to: 'jurisdiction_settings', inverse: 'payroll_runs' },
	'payroll_runs.early_for_id': {
		to: 'payroll_runs',
		inverse: 'early_settlements',
		optional: true,
		onDelete: 'setNull'
	},
	'payslips.payroll_run_id': { to: 'payroll_runs', inverse: 'payslips', owned: true },
	'payslips.employment_id': { to: 'employee_profiles', inverse: 'payslips' },
	'obligations.company_id': {
		to: 'entities',
		inverse: 'obligations',
		owned: true
	},
	'obligations.source_obligation_id': { to: 'obligations', inverse: 'source_dependents', optional: true },
	'obligations.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'obligation_instances'
	},
	'work_catalogue.settings_id': { to: 'jurisdiction_settings', inverse: 'work_catalogue', owned: true },
 'rule_sets.settings_id': { to: 'jurisdiction_settings', inverse: 'rule_sets', owned: true, optional: true },
	'catalogue_entries.company_id': { to: 'entities', inverse: 'catalogue_entries' },
	'catalogue_entries.employment_id': { to: 'employee_profiles', inverse: 'catalogue_entries', optional: true },
	'catalogue_entries.payslip_id': { to: 'payslips', inverse: 'catalogue_entries', optional: true, onDelete: 'setNull' }
});
