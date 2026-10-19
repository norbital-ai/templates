import type { StoredSelect } from './foundation.js';

export const SETTINGS = {
	id: true,
	code: true,
	effective_range: true,
	sealed_at: true,
	voided_at: true,
	payroll: true,
	behaviours: true,
	suspension_kinds: true
} as const satisfies StoredSelect<'jurisdiction_settings'>;

export const ENTITY = {
	id: true,
	name: true,
	settings_code: true,
	pay_cutoff_day: true,
	pay_frequency: true,
	pay_frequency_changes: true,
	region: true,
	risk_class: true,
	time_zone: true,
	facts: true,
	validation_severity: true
} as const satisfies StoredSelect<'entity'>;

export const CONTRACT = {
	id: true,
	employee_id: true,
	company_id: true,
	effective_range: true,
	prior_service_months: true,
	engagement: true,
	exit_ground: true,
	exit_facts: true,
	facts: true
} as const satisfies StoredSelect<'employment_contract'>;

export const PROFILE = {
	id: true,
	name: true,
	date_of_birth: true,
	nationality: true,
	race: true,
	religion: true,
	gender: true,
	marital_status: true,
	spouse_status: true,
	solo_parent: true,
	disabled: true,
	receiving_pension: true,
	children: true,
	dependents_count: true,
	facts: true
} as const satisfies StoredSelect<'employment_profile'>;
/** Each family's own columns beside the common ones: a read naming a column its model lacks is refused. */

export const ENTRY = {
	adhoc_catalog_entry: {
		id: true,
		catalog_id: true,
		employment_id: true,
		company_id: true,
		reference: true,
		occurred_on: true,
		activity: true,
		amount: true,
		label: true,
		facts: true,
		payslip_id: true,
		quantity: true
	},
	claim_catalog_entry: {
		id: true,
		catalog_id: true,
		employment_id: true,
		company_id: true,
		reference: true,
		occurred_on: true,
		activity: true,
		amount: true,
		label: true,
		facts: true,
		payslip_id: true,
		quantity: true,
		incurred_on: true,
		due_on: true
	},
	leave_catalog_entry: {
		id: true,
		catalog_id: true,
		employment_id: true,
		company_id: true,
		reference: true,
		occurred_on: true,
		activity: true,
		amount: true,
		label: true,
		facts: true,
		payslip_id: true,
		days: true,
		from: true,
		to: true,
		incurred_on: true
	},
	loan_catalog_entry: {
		id: true,
		catalog_id: true,
		employment_id: true,
		company_id: true,
		reference: true,
		occurred_on: true,
		activity: true,
		amount: true,
		label: true,
		facts: true,
		payslip_id: true
	}
} as const satisfies {
	adhoc_catalog_entry: StoredSelect<'adhoc_catalog_entry'>;
	claim_catalog_entry: StoredSelect<'claim_catalog_entry'>;
	leave_catalog_entry: StoredSelect<'leave_catalog_entry'>;
	loan_catalog_entry: StoredSelect<'loan_catalog_entry'>;
};

export const STATUTORY = {
	id: true,
	settings_id: true,
	code: true,
	configuration: true
} as const satisfies StoredSelect<'statutory_contribution_catalog'>;

export const RULES = { code: true, rules: true } as const satisfies StoredSelect<'rule_set'>;
export const RULE_SET = {
	id: true,
	settings_id: true,
	family: true,
	code: true,
	rules: true
} as const satisfies StoredSelect<'rule_set'>;

export const LEAVE_CLASS = {
	id: true,
	settings_id: true,
	code: true,
	name: true,
	eligibility: true,
	can_encash: true,
	is_npl: true,
	consumes_code: true,
	entitlement: true
} as const satisfies StoredSelect<'leave_catalog'>;

export const ROSTER = {
	id: true,
	employment_id: true,
	work_date: true,
	shift_definition_id: true,
	worked_intervals: true,
	banked_overtime_hours: true,
	banked_overtime_band: true,
	overtime_consented_at: true,
	worksite: true,
	facts: true,
	payslip_id: true
} as const satisfies StoredSelect<'roster_entry'>;

export const HOLIDAY = {
	id: true,
	date: true,
	name: true,
	kind: true,
	published_at: true,
	replaces: true,
	given_to: true
} as const satisfies StoredSelect<'holiday'>;

export const HISTORY = {
	id: true,
	payroll_run_id: true,
	employment_id: true,
	status: true,
	proration: true,
	salary_from: true,
	statutory: true,
	base: true,
	adjustments: true,
	gross: true,
	net: true
} as const satisfies StoredSelect<'payslip'>;

export const CATALOG = {
	adhoc_catalog: {
		id: true,
		settings_id: true,
		code: true,
		name: true,
		destination: true,
		direction: true,
		counts_toward: true,
		eligibility: true,
		qualifies_when: true,
		bands: true,
		payable_after_exit: true,
		raise_on_exit: true,
		amount_required: true
	},
	claim_catalog: {
		id: true,
		settings_id: true,
		code: true,
		name: true,
		destination: true,
		direction: true,
		counts_toward: true,
		eligibility: true,
		qualifies_when: true,
		bands: true,
		amount_required: true
	},
	leave_catalog: {
		id: true,
		settings_id: true,
		code: true,
		name: true,
		eligibility: true,
		is_npl: true,
		can_encash: true,
		pay_fraction: true,
		share_by: true
	},
	loan_catalog: {
		id: true,
		settings_id: true,
		code: true,
		name: true,
		destination: true,
		direction: true,
		eligibility: true,
		bands: true,
		amount_required: true
	},
	allowance_catalog: {
		id: true,
		settings_id: true,
		code: true,
		name: true,
		destination: true,
		direction: true,
		counts_toward: true,
		eligibility: true,
		amount: true
	},
	work_catalog: {
		id: true,
		settings_id: true,
		code: true,
		name: true,
		component_code: true,
		eligibility: true,
		quantity: true,
		rate: true,
		prorated: true,
		denominator: true,
		destination: true,
		direction: true,
		counts_toward: true
	}
} as const satisfies {
	adhoc_catalog: StoredSelect<'adhoc_catalog'>;
	claim_catalog: StoredSelect<'claim_catalog'>;
	leave_catalog: StoredSelect<'leave_catalog'>;
	loan_catalog: StoredSelect<'loan_catalog'>;
	allowance_catalog: StoredSelect<'allowance_catalog'>;
	work_catalog: StoredSelect<'work_catalog'>;
};

/** Every scalar field the row taps expose to their rules; biometric and file payloads stay out. */
export const TRIGGER = {
	payroll_run: {
		id: true,
		period: true,
		kind: true,
		sequence: true,
		sources: true,
		configuration_hash: true,
		pay_date: true,
		pay_due_date: true,
		salary_from: true,
		salary_to: true,
		attendance_from: true,
		attendance_to: true,
		warnings: true,
		pins: true,
		holds: true,
		company_id: true,
		settings_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	payslip: {
		id: true,
		terms_through: true,
		salary_from: true,
		salary_to: true,
		service_basis: true,
		base: true,
		proration: true,
		statutory: true,
		adjustments: true,
		status: true,
		paid_at: true,
		currency: true,
		gross: true,
		total_deductions: true,
		net: true,
		employer_cost: true,
		payroll_run_id: true,
		employment_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	employment_contract: {
		id: true,
		employee_number: true,
		contract_number: true,
		bank: true,
		effective_range: true,
		signed_contract_end: true,
		before: true,
		engagement: true,
		prior_service_months: true,
		exit_ground: true,
		exit_facts: true,
		comments: true,
		facts: true,
		employee_id: true,
		company_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	employment_profile: {
		id: true,
		name: true,
		date_of_birth: true,
		gender: true,
		marital_status: true,
		solo_parent: true,
		disabled: true,
		receiving_pension: true,
		race: true,
		religion: true,
		spouse_status: true,
		children: true,
		nationality: true,
		identity_number: true,
		dependents_count: true,
		email: true,
		phone: true,
		address: true,
		location: true,
		anonymised_at: true,
		facts: true,
		before: true,
		invitation_id: true,
		user_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	entity: {
		id: true,
		settings_code: true,
		name: true,
		registration_number: true,
		pay_cutoff_day: true,
		late_arrival_grace_minutes: true,
		pay_frequency: true,
		pay_frequency_changes: true,
		risk_class: true,
		region: true,
		facts: true,
		before: true,
		time_zone: true,
		disbursement_account: true,
		effective_range: true,
		hotline: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	leave_catalog_entry: {
		id: true,
		reference: true,
		occurred_on: true,
		activity: true,
		days: true,
		from: true,
		to: true,
		amount: true,
		half_day_start: true,
		half_day_end: true,
		incurred_on: true,
		label: true,
		facts: true,
		catalog_id: true,
		company_id: true,
		employment_id: true,
		payslip_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	claim_catalog_entry: {
		id: true,
		reference: true,
		occurred_on: true,
		activity: true,
		amount: true,
		quantity: true,
		incurred_on: true,
		due_on: true,
		label: true,
		facts: true,
		catalog_id: true,
		company_id: true,
		employment_id: true,
		payslip_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	adhoc_catalog_entry: {
		id: true,
		reference: true,
		occurred_on: true,
		activity: true,
		amount: true,
		quantity: true,
		label: true,
		facts: true,
		catalog_id: true,
		company_id: true,
		employment_id: true,
		payslip_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	loan_catalog_entry: {
		id: true,
		reference: true,
		occurred_on: true,
		activity: true,
		amount: true,
		label: true,
		facts: true,
		catalog_id: true,
		company_id: true,
		employment_id: true,
		payslip_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	roster_entry: {
		id: true,
		work_date: true,
		worked_intervals: true,
		banked_overtime_hours: true,
		banked_overtime_band: true,
		overtime_consented_at: true,
		worksite: true,
		facts: true,
		employment_id: true,
		shift_definition_id: true,
		payslip_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	obligation: {
		id: true,
		duty_code: true,
		authority: true,
		occurrence_key: true,
		trigger_ref: true,
		triggered_on: true,
		due_on: true,
		currency: true,
		amount_due: true,
		amount_settled: true,
		state: true,
		fulfilled_on: true,
		waive_reason: true,
		reference: true,
		facts: true,
		company_id: true,
		settings_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	regulatory_task: {
		id: true,
		code: true,
		title: true,
		authority: true,
		subject_collection: true,
		subject_id: true,
		trigger_ref: true,
		triggered_on: true,
		due_on: true,
		state: true,
		done_on: true,
		dismiss_reason: true,
		occurrence_key: true,
		facts: true,
		company_id: true,
		settings_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	workplace_case: {
		id: true,
		kind: true,
		opened_on: true,
		closed_on: true,
		before: true,
		facts: true,
		company_id: true,
		employment_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	},
	work_suspension: {
		id: true,
		kind: true,
		starts_on: true,
		ends_on: true,
		worksite: true,
		employment_ids: true,
		facts: true,
		company_id: true,
		revision: true,
		created_at: true,
		created_by: true,
		updated_at: true,
		updated_by: true
	}
} as const satisfies {
	payroll_run: StoredSelect<'payroll_run'>;
	payslip: StoredSelect<'payslip'>;
	employment_contract: StoredSelect<'employment_contract'>;
	employment_profile: StoredSelect<'employment_profile'>;
	entity: StoredSelect<'entity'>;
	leave_catalog_entry: StoredSelect<'leave_catalog_entry'>;
	claim_catalog_entry: StoredSelect<'claim_catalog_entry'>;
	adhoc_catalog_entry: StoredSelect<'adhoc_catalog_entry'>;
	loan_catalog_entry: StoredSelect<'loan_catalog_entry'>;
	roster_entry: StoredSelect<'roster_entry'>;
	obligation: StoredSelect<'obligation'>;
	regulatory_task: StoredSelect<'regulatory_task'>;
	workplace_case: StoredSelect<'workplace_case'>;
	work_suspension: StoredSelect<'work_suspension'>;
};

/** The complete catalogue values that row-event rules may inspect. */
export const CATALOG_DETAILS = {
	adhoc_catalog: {
		id: true,
		code: true,
		name: true,
		authority: true,
		destination: true,
		direction: true,
		bands: true,
		eligibility: true,
		qualifies_when: true,
		amount_required: true,
		counts_toward: true,
		raise_on_exit: true,
		payable_after_exit: true
	},
	claim_catalog: {
		id: true,
		code: true,
		name: true,
		authority: true,
		destination: true,
		direction: true,
		bands: true,
		eligibility: true,
		qualifies_when: true,
		amount_required: true,
		counts_toward: true
	},
	leave_catalog: {
		id: true,
		code: true,
		name: true,
		description: true,
		authority: true,
		eligibility: true,
		unit: true,
		can_encash: true,
		encash_on_exit: true,
		encash_at_window_end: true,
		entitlement: true,
		is_npl: true,
		pay_fraction: true,
		share_by: true,
		consumes_code: true
	},
	loan_catalog: {
		id: true,
		code: true,
		name: true,
		authority: true,
		destination: true,
		direction: true,
		bands: true,
		eligibility: true,
		amount_required: true
	}
} as const satisfies {
	adhoc_catalog: StoredSelect<'adhoc_catalog'>;
	claim_catalog: StoredSelect<'claim_catalog'>;
	leave_catalog: StoredSelect<'leave_catalog'>;
	loan_catalog: StoredSelect<'loan_catalog'>;
};
