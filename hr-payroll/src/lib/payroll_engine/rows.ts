import type { Fields } from './foundation.js';

export const SETTINGS = [
	'code',
	'effective_range',
	'sealed_at',
	'voided_at',
	'payroll',
	'behaviours',
	'suspension_kinds'
] as const satisfies Fields<'jurisdiction_settings'>;

export const ENTITY = [
	'name',
	'settings_code',
	'pay_cutoff_day',
	'pay_frequency',
	'pay_frequency_changes',
	'region',
	'risk_class',
	'time_zone',
	'facts',
	'validation_severity'
] as const satisfies Fields<'entity'>;

export const CONTRACT = [
	'employee_id',
	'company_id',
	'effective_range',
	'prior_service_months',
	'engagement',
	'exit_ground',
	'exit_facts',
	'facts'
] as const satisfies Fields<'employment_contract'>;

export const PROFILE = [
	'name',
	'date_of_birth',
	'nationality',
	'gender',
	'marital_status',
	'children',
	'facts'
] as const satisfies Fields<'employment_profile'>;
/** Each family's own columns beside the common ones: a read naming a column its model lacks is refused. */

export const ENTRY = {
	adhoc_catalog_entry: [
		'catalog_id',
		'employment_id',
		'company_id',
		'occurred_on',
		'activity',
		'amount',
		'label',
		'facts',
		'payslip_id',
		'quantity'
	],
	claim_catalog_entry: [
		'catalog_id',
		'employment_id',
		'company_id',
		'occurred_on',
		'activity',
		'amount',
		'label',
		'facts',
		'payslip_id',
		'quantity',
		'incurred_on',
		'due_on'
	],
	leave_catalog_entry: [
		'catalog_id',
		'employment_id',
		'company_id',
		'reference',
		'occurred_on',
		'activity',
		'amount',
		'label',
		'facts',
		'payslip_id',
		'days',
		'from',
		'to'
	],
	loan_repayment_entry: [
		'loan_id',
		'catalog_id',
		'employment_id',
		'company_id',
		'occurred_on',
		'activity',
		'amount',
		'payslip_id'
	]
} as const satisfies {
	adhoc_catalog_entry: Fields<'adhoc_catalog_entry'>;
	claim_catalog_entry: Fields<'claim_catalog_entry'>;
	leave_catalog_entry: Fields<'leave_catalog_entry'>;
	loan_repayment_entry: Fields<'loan_repayment_entry'>;
};

export const LOAN = [
	'catalog_id',
	'employment_id',
	'company_id',
	'principal_amount',
	'facts',
	'advance_made_on'
] as const satisfies Fields<'loan_catalog_entry'>;

export const STATUTORY = [
	'settings_id',
	'code',
	'configuration'
] as const satisfies Fields<'statutory_contribution_catalog'>;

export const RULES = ['code', 'rules'] as const satisfies Fields<'rule_set'>;
export const RULE_SET = [
	'settings_id',
	'family',
	'code',
	'rules'
] as const satisfies Fields<'rule_set'>;

export const LEAVE_CLASS = [
	'settings_id',
	'code',
	'name',
	'eligibility',
	'can_encash',
	'is_npl',
	'consumes_code',
	'entitlement',
	'unit',
	'unplanned_days'
] as const satisfies Fields<'leave_catalog'>;

export const ROSTER = [
	'employment_id',
	'work_date',
	'shift_definition_id',
	'planned_overtime_hours',
	'approved_overtime_intervals',
	'worked_intervals',
	'banked_overtime_hours',
	'banked_overtime_band',
	'overtime_consented_at',
	'worksite',
	'facts',
	'payslip_id'
] as const satisfies Fields<'roster_entry'>;

export const HOLIDAY = [
	'company_id',
	'date',
	'name',
	'kind',
	'published_at',
	'replaces',
	'given_to'
] as const satisfies Fields<'holiday'>;

export const HISTORY = [
	'payroll_run_id',
	'employment_id',
	'status',
	'proration',
	'salary_from',
	'statutory',
	'base',
	'adjustments',
	'gross',
	'net'
] as const satisfies Fields<'payslip'>;

export const CATALOG = {
	adhoc_catalog: [
		'settings_id',
		'code',
		'name',
		'destination',
		'direction',
		'counts_toward',
		'eligibility',
		'qualifies_when',
		'bands',
		'payable_after_exit',
		'raise_on_exit',
		'amount_required'
	],
	claim_catalog: [
		'settings_id',
		'code',
		'name',
		'destination',
		'direction',
		'counts_toward',
		'eligibility',
		'qualifies_when',
		'bands',
		'amount_required'
	],
	leave_catalog: [
		'settings_id',
		'code',
		'name',
		'eligibility',
		'is_npl',
		'can_encash',
		'pay_fraction',
		'share_by'
	],
	loan_catalog: [
		'settings_id',
		'code',
		'name',
		'destination',
		'direction',
		'eligibility',
		'bands',
		'amount_required'
	],
	allowance_catalog: [
		'settings_id',
		'code',
		'name',
		'destination',
		'direction',
		'counts_toward',
		'eligibility',
		'amount'
	],
	work_catalog: [
		'settings_id',
		'code',
		'name',
		'component_code',
		'eligibility',
		'quantity',
		'rate',
		'prorated',
		'denominator',
		'destination',
		'direction',
		'counts_toward'
	]
} as const satisfies {
	adhoc_catalog: Fields<'adhoc_catalog'>;
	claim_catalog: Fields<'claim_catalog'>;
	leave_catalog: Fields<'leave_catalog'>;
	loan_catalog: Fields<'loan_catalog'>;
	allowance_catalog: Fields<'allowance_catalog'>;
	work_catalog: Fields<'work_catalog'>;
};

/** Every scalar field the row taps expose to their rules; biometric and file payloads stay out. */
export const TRIGGER = {
	payroll_run: [
		'period',
		'kind',
		'sequence',
		'sources',
		'configuration_hash',
		'pay_date',
		'pay_due_date',
		'salary_from',
		'salary_to',
		'attendance_from',
		'attendance_to',
		'warnings',
		'pins',
		'holds',
		'company_id',
		'settings_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	payslip: [
		'terms_through',
		'salary_from',
		'salary_to',
		'service_basis',
		'base',
		'proration',
		'statutory',
		'adjustments',
		'company_payments',
		'status',
		'paid_at',
		'currency',
		'gross',
		'total_deductions',
		'net',
		'employer_cost',
		'payroll_run_id',
		'employment_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	employment_contract: [
		'employee_number',
		'contract_number',
		'bank',
		'effective_range',
		'signed_contract_end',
		'before',
		'engagement',
		'prior_service_months',
		'exit_ground',
		'exit_facts',
		'comments',
		'facts',
		'employee_id',
		'company_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	employment_profile: [
		'name',
		'date_of_birth',
		'gender',
		'marital_status',
		'children',
		'nationality',
		'identity_number',
		'email',
		'phone',
		'address',
		'location',
		'anonymised_at',
		'facts',
		'before',
		'invitation_id',
		'user_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	entity: [
		'settings_code',
		'name',
		'registration_number',
		'pay_cutoff_day',
		'late_arrival_grace_minutes',
		'pay_frequency',
		'pay_frequency_changes',
		'risk_class',
		'region',
		'facts',
		'before',
		'time_zone',
		'disbursement_account',
		'effective_range',
		'hotline',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	leave_catalog_entry: [
		'reference',
		'occurred_on',
		'activity',
		'days',
		'from',
		'to',
		'amount',
		'half_day_start',
		'half_day_end',
		'label',
		'facts',
		'catalog_id',
		'company_id',
		'employment_id',
		'payslip_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	claim_catalog_entry: [
		'occurred_on',
		'activity',
		'amount',
		'quantity',
		'incurred_on',
		'due_on',
		'label',
		'facts',
		'catalog_id',
		'company_id',
		'employment_id',
		'payslip_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	adhoc_catalog_entry: [
		'occurred_on',
		'activity',
		'amount',
		'quantity',
		'label',
		'facts',
		'catalog_id',
		'company_id',
		'employment_id',
		'payslip_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	loan_catalog_entry: [
		'principal_amount',
		'repayment_period',
		'repayment_frequency',
		'facts',
		'advance_made_on',
		'catalog_id',
		'company_id',
		'employment_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	roster_entry: [
		'work_date',
		'planned_overtime_hours',
		'approved_overtime_intervals',
		'worked_intervals',
		'banked_overtime_hours',
		'banked_overtime_band',
		'overtime_consented_at',
		'worksite',
		'facts',
		'employment_id',
		'shift_definition_id',
		'payslip_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	obligation: [
		'duty_code',
		'references',
		'occurrence_key',
		'trigger_ref',
		'triggered_on',
		'due_on',
		'currency',
		'amount_due',
		'amount_settled',
		'state',
		'fulfilled_on',
		'waive_reason',
		'reference',
		'facts',
		'company_id',
		'settings_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	regulatory_task: [
		'code',
		'title',
		'references',
		'subject_collection',
		'subject_id',
		'trigger_ref',
		'triggered_on',
		'due_on',
		'state',
		'done_on',
		'dismiss_reason',
		'occurrence_key',
		'facts',
		'company_id',
		'settings_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	workplace_case: [
		'kind',
		'opened_on',
		'closed_on',
		'before',
		'facts',
		'company_id',
		'employment_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	],
	work_suspension: [
		'kind',
		'starts_on',
		'ends_on',
		'worksite',
		'employment_ids',
		'facts',
		'company_id',
		'revision',
		'created_at',
		'created_by',
		'updated_at',
		'updated_by'
	]
} as const satisfies {
	payroll_run: Fields<'payroll_run'>;
	payslip: Fields<'payslip'>;
	employment_contract: Fields<'employment_contract'>;
	employment_profile: Fields<'employment_profile'>;
	entity: Fields<'entity'>;
	leave_catalog_entry: Fields<'leave_catalog_entry'>;
	claim_catalog_entry: Fields<'claim_catalog_entry'>;
	adhoc_catalog_entry: Fields<'adhoc_catalog_entry'>;
	loan_catalog_entry: Fields<'loan_catalog_entry'>;
	roster_entry: Fields<'roster_entry'>;
	obligation: Fields<'obligation'>;
	regulatory_task: Fields<'regulatory_task'>;
	workplace_case: Fields<'workplace_case'>;
	work_suspension: Fields<'work_suspension'>;
};

/** The complete catalogue values that row-event rules may inspect. */
export const CATALOG_DETAILS = {
	adhoc_catalog: [
		'code',
		'name',
		'references',
		'destination',
		'direction',
		'bands',
		'eligibility',
		'qualifies_when',
		'amount_required',
		'counts_toward',
		'raise_on_exit',
		'payable_after_exit'
	],
	claim_catalog: [
		'code',
		'name',
		'references',
		'destination',
		'direction',
		'bands',
		'eligibility',
		'qualifies_when',
		'amount_required',
		'counts_toward'
	],
	leave_catalog: [
		'code',
		'name',
		'description',
		'references',
		'eligibility',
		'unit',
		'can_encash',
		'encash_on_exit',
		'encash_at_window_end',
		'entitlement',
		'is_npl',
		'pay_fraction',
		'share_by',
		'consumes_code'
	],
	loan_catalog: [
		'code',
		'name',
		'references',
		'destination',
		'direction',
		'bands',
		'eligibility',
		'amount_required'
	]
} as const satisfies {
	adhoc_catalog: Fields<'adhoc_catalog'>;
	claim_catalog: Fields<'claim_catalog'>;
	leave_catalog: Fields<'leave_catalog'>;
	loan_catalog: Fields<'loan_catalog'>;
};
