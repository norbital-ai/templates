import { relationship } from '@norbital-ai/bolt';

/**
 * The relation graph. Every foreign key is declared here, never in a model.
 *
 * `owned` is composition: the child is deleted with its parent and never moves to another. Everything else is
 * `restrict`: the parent cannot be deleted while children point at it, which is a deliberate answer — a settled
 * claim, a paid repayment or a captured work day is money history.
 *
 * The payroll pin: every entry family and `work_days` carries an optional `payslip_id`. The run's transform links
 * it on capture; deleting a DRAFT/ON_HOLD payslip releases it through `setNull`. A PAID payslip is never deleted,
 * so a paid source stays locked (each family's transform refuses writes while pinned).
 *
 * `payslips.base/proration/statutory/adjustments` name codes and source ids, never edges: a settled payslip is a
 * frozen statement and does not become wrong because a catalogue row was later archived.
 */
export default relationship({
	// ── law: a settings version owns its schemes and catalogues ──
	'jurisdiction_settings.cloned_from_id': {
		to: 'jurisdiction_settings',
		inverse: 'clones',
		optional: true,
		onDelete: 'setNull'
	},
	'reference_rows.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'reference_rows',
		owned: true
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

	// ── the entity and what it owns or names ──
	'jurisdiction_holidays.company_id': { to: 'companies', inverse: 'jurisdiction_holidays' },
	'company_facts.company_id': { to: 'companies', inverse: 'company_facts', owned: true },
	'shift_definitions.company_id': { to: 'companies', inverse: 'shift_definitions' },
	'shift_patterns.company_id': { to: 'companies', inverse: 'shift_patterns' },
	/** An establishment's dated revisions; a revision terms or days name cannot be deleted. */
	'worksites.company_id': { to: 'companies', inverse: 'worksites', owned: true },

	// ── people and contracts ──
	/** The member this person signs in as; a removed member leaves the person unlinked. */
	'employees.user_id': { to: 'sys_user', optional: true, onDelete: 'setNull' },
	'employments.employee_id': { to: 'employees', inverse: 'employments' },
	'employments.company_id': { to: 'companies', inverse: 'employments' },
	'employment_terms.employment_id': { to: 'employments', inverse: 'employment_terms', owned: true },
	/** The base the terms project their days from; a pattern in use cannot be deleted. */
	'employment_terms.shift_pattern_id': { to: 'shift_patterns', inverse: 'employment_terms' },
	/** The establishment the terms are worked at; the revision of its code in force on a date governs. */
	'employment_terms.worksite_id': { to: 'worksites', inverse: 'employment_terms', optional: true },
	'person_facts.employee_id': { to: 'employees', inverse: 'person_facts', owned: true },
	/** Null for the personal row; an employment row overrides it key by key for that employment. */
	'person_facts.employment_id': {
		to: 'employments',
		inverse: 'person_facts',
		optional: true
	},
	'employment_history.employee_id': {
		to: 'employees',
		inverse: 'employment_history',
		owned: true
	},
	'employment_statutory_facts.employee_id': {
		to: 'employees',
		inverse: 'employment_statutory_facts',
		owned: true
	},
	/** Null for the personal registration; an employment binds employer-specific instructions. */
	'employment_statutory_facts.employment_id': {
		to: 'employments',
		inverse: 'employment_statutory_facts',
		optional: true
	},
	'employment_statutory_facts.statutory_contribution_id': {
		to: 'statutory_contributions',
		inverse: 'employment_statutory_facts'
	},
	'contribution_statement_months.employee_id': {
		to: 'employees',
		inverse: 'contribution_statement_months',
		owned: true
	},
	'benefit_cases.employee_id': { to: 'employees', inverse: 'benefit_cases' },
	'benefit_cases.employment_id': { to: 'employments', inverse: 'benefit_cases' },
	'benefit_case_movements.benefit_case_id': {
		to: 'benefit_cases',
		inverse: 'benefit_case_movements'
	},
	'benefit_case_movements.benefit_case_plan_id': {
		to: 'benefit_case_plans',
		inverse: 'benefit_case_movements',
		optional: true
	},
	'benefit_case_plans.benefit_case_id': {
		to: 'benefit_cases',
		inverse: 'benefit_case_plans',
		owned: true
	},
	'benefit_case_plans.supersedes_plan_id': {
		to: 'benefit_case_plans',
		inverse: 'superseded_by',
		optional: true
	},
	'benefit_case_cutoffs.benefit_case_plan_id': {
		to: 'benefit_case_plans',
		inverse: 'benefit_case_cutoffs',
		owned: true
	},
	'employment_wage_periods.employment_id': {
		to: 'employments',
		inverse: 'employment_wage_periods',
		owned: true
	},
	'presence_periods.employee_id': { to: 'employees', inverse: 'presence_periods', owned: true },
	'payment_holds.employment_id': { to: 'employments', inverse: 'payment_holds', owned: true },

	// ── time ──
	'rosters.employment_id': { to: 'employments', inverse: 'rosters' },
	'work_days.employment_id': { to: 'employments', inverse: 'work_days' },
	/** The plan: a shift window, OFF or REST. Null is a day with no plan. */
	'work_days.shift_definition_id': {
		to: 'shift_definitions',
		inverse: 'work_days',
		optional: true
	},
	/** Where the day was worked when not at the terms' worksite. */
	'work_days.worksite_id': { to: 'worksites', inverse: 'work_days', optional: true },
	'work_days.payslip_id': {
		to: 'payslips',
		inverse: 'work_days',
		optional: true,
		onDelete: 'setNull'
	},

	// ── leave ──
	'leave_entries.employment_id': { to: 'employments', inverse: 'leave_entries' },
	'leave_entries.catalogue_id': { to: 'leave_catalogue', inverse: 'leave_entries' },
	/** The approved entry this reversal cancels; unique, so a source reverses once. */
	'leave_entries.reversal_of_id': { to: 'leave_entries', inverse: 'reversals', optional: true },
	/** The episode's first entry: one continuing absence (a maternity, a stoppage) across entries and periods. */
	'leave_entries.episode_id': { to: 'leave_entries', inverse: 'episode_entries', optional: true },
	'leave_entries.payslip_id': {
		to: 'payslips',
		inverse: 'leave_entries',
		optional: true,
		onDelete: 'setNull'
	},

	// ── pay requests: money that moved or is owed; restrict keeps them from going with an employment ──
	'claim_requests.employment_id': { to: 'employments', inverse: 'claim_requests' },
	'claim_requests.catalogue_id': { to: 'claim_catalogue', inverse: 'claim_requests' },
	'claim_requests.payslip_id': {
		to: 'payslips',
		inverse: 'claim_requests',
		optional: true,
		onDelete: 'setNull'
	},
	'adhoc_requests.employment_id': { to: 'employments', inverse: 'adhoc_requests' },
	'adhoc_requests.catalogue_id': { to: 'adhoc_catalogue', inverse: 'adhoc_requests' },
	'adhoc_requests.payslip_id': {
		to: 'payslips',
		inverse: 'adhoc_requests',
		optional: true,
		onDelete: 'setNull'
	},
	'loans.employment_id': { to: 'employments', inverse: 'loans' },
	'loans.loan_catalogue_id': { to: 'loan_catalogue', inverse: 'loans' },
	'loan_repayments.loan_id': { to: 'loans', inverse: 'loan_repayments', owned: true },
	'loan_repayments.employment_id': { to: 'employments', inverse: 'loan_repayments' },
	'loan_repayments.payslip_id': {
		to: 'payslips',
		inverse: 'loan_repayments',
		optional: true,
		onDelete: 'setNull'
	},

	// ── payroll ──
	'payroll_runs.company_id': { to: 'companies', inverse: 'payroll_runs' },
	/** The sealed version the run was calculated under; a version a run used is history. */
	'payroll_runs.settings_id': { to: 'jurisdiction_settings', inverse: 'payroll_runs' },
	'payslips.payroll_run_id': { to: 'payroll_runs', inverse: 'payslips', owned: true },
	'payslips.employment_id': { to: 'employments', inverse: 'payslips' },
	/** The event which completed the last frozen obligation on this payslip. */
	'payslips.settled_by_payment_event_id': {
		to: 'payment_events',
		inverse: 'completed_payslips',
		optional: true
	},
	'noncontract_settlements.company_id': {
		to: 'companies',
		inverse: 'noncontract_settlements'
	},
	'noncontract_settlements.employee_id': {
		to: 'employees',
		inverse: 'noncontract_settlements'
	},
	/** Exactly one priced obligation owns a tranche; settled cash keeps its source alive. */
	'payable_tranches.settlement': {
		to: ['payslips', 'noncontract_settlements'],
		inverse: 'payable_tranches',
		owned: true
	},
	'payment_events.company_id': { to: 'companies', inverse: 'payment_events' },
	'payment_events.employee_id': { to: 'employees', inverse: 'payment_events' },
	'payment_allocations.payment_event_id': {
		to: 'payment_events',
		inverse: 'payment_allocations',
		owned: true
	},
	'payment_allocations.payable_tranche_id': {
		to: 'payable_tranches',
		inverse: 'payment_allocations'
	},
	/** The entity that owes the duty; its ledger goes with it. */
	'obligation_instances.company_id': {
		to: 'companies',
		inverse: 'obligation_instances',
		owned: true
	},
	/** The sealed version whose duty type raised the instance; a version a duty used is history. */
	'obligation_instances.settings_id': {
		to: 'jurisdiction_settings',
		inverse: 'obligation_instances'
	},
	/** One declared fact's evidence; it goes with the subject it evidences. */
	'fact_evidence.subject': {
		to: [
			'company_facts',
			'employment_terms',
			'work_days',
			'payment_events',
			'noncontract_settlements',
			'benefit_cases',
			'person_facts',
			'worksites',
			'employments',
			'leave_entries',
			'adhoc_requests',
			'claim_requests',
			'employment_statutory_facts',
			'employment_history',
			'obligation_instances'
		],
		inverse: 'fact_evidence',
		owned: true
	},
	'payslip_wage_periods.payslip_id': {
		to: 'payslips',
		inverse: 'payslip_wage_periods',
		owned: true
	},
	/** Wage evidence a standing payslip used is immutable. */
	'payslip_wage_periods.wage_period_id': {
		to: 'employment_wage_periods',
		inverse: 'payslip_wage_periods'
	}
});
