/**
 * The literals the policies share: self-service scopes, approval routes and the grant fragments several ranks repeat.
 *
 * A policy states its whole authority in its own file; this module only names the pieces several of them repeat,
 * so a route or a scope is written once. Every refusal that reads other rows lives in its collection's transform.
 */

/** The signed-in member's own employee row: the email compares case-folded. */
export const OWN_EMPLOYEE = { email: { eq: { actor: 'email' } } } as const;
/** An employment whose employee is the signed-in member. */
export const OWN_EMPLOYMENT = { employee_id: { is: OWN_EMPLOYEE } } as const;
/** A row about one of the member's own employments. */
export const OWN = { employment_id: { is: OWN_EMPLOYMENT } } as const;

/** A row no payslip consumed; a consumed one is released by deleting that payroll run. */
/** An entry no run has settled. */
export const UNPINNED = { payslip_id: { isNull: true } } as const;
/** An entry a run settled: the pin write moves a row from `UNPINNED` here, so the update arm must admit the
 * post-image too (`previous` judges the pre-image, `where` the post-image). */
export const PINNED = { payslip_id: { isNull: false } } as const;
/** A version still a draft: never sealed, never voided. */
export const DRAFT_VERSION = { sealed_at: { isNull: true }, voided_at: { isNull: true } } as const;
/** A catalogue row of a draft version; a sealed version's rows are fixed. */
export const DRAFT_SETTINGS_ROW = { settings_id: { is: DRAFT_VERSION } } as const;

/** What a person may say about a new entry; the company comes from the employment, the pin from the run. */
/** Each entry family writes its own columns; `facts` is the one open field all four carry. */
const ADHOC_ENTRY_FIELDS = [
	'catalog_id',
	'employment_id',
	'occurred_on',
	'activity',
	'amount',
	'quantity',
	'label',
	'facts',
	'reference'
] as const;
const ADHOC_ENTRY_EDIT = [
	'catalog_id',
	'occurred_on',
	'activity',
	'amount',
	'quantity',
	'label',
	'facts',
	'reference'
] as const;

const CLAIM_ENTRY_FIELDS = [
	'catalog_id',
	'employment_id',
	'occurred_on',
	'activity',
	'amount',
	'quantity',
	'incurred_on',
	'due_on',
	'label',
	'facts',
	'reference'
] as const;
const CLAIM_ENTRY_EDIT = [
	'catalog_id',
	'occurred_on',
	'activity',
	'amount',
	'quantity',
	'incurred_on',
	'due_on',
	'label',
	'facts',
	'reference'
] as const;

const LEAVE_ENTRY_FIELDS = [
	'catalog_id',
	'employment_id',
	'occurred_on',
	'activity',
	'days',
	'half_day_start',
	'half_day_end',
	'from',
	'to',
	'amount',
	'incurred_on',
	'label',
	'facts',
	'reference'
] as const;
const LEAVE_ENTRY_EDIT = [
	'catalog_id',
	'occurred_on',
	'activity',
	'days',
	'half_day_start',
	'half_day_end',
	'from',
	'to',
	'amount',
	'incurred_on',
	'label',
	'facts',
	'reference'
] as const;

const LOAN_ENTRY_FIELDS = [
	'catalog_id',
	'employment_id',
	'occurred_on',
	'activity',
	'amount',
	'label',
	'facts',
	'reference'
] as const;
const LOAN_ENTRY_EDIT = [
	'catalog_id',
	'occurred_on',
	'activity',
	'amount',
	'label',
	'facts',
	'reference'
] as const;
/** Both sides of the day: the plan (roster code, overtime and incentive hours) and the clock. */
export const ROSTER_ENTRY_ATTENDANCE_FIELDS = [
	'employment_id',
	'work_date',
	'worked_intervals'
] as const;

export const ROSTER_ENTRY_FULL_FIELDS = [
	'employment_id',
	'work_date',
	'shift_definition_id',
	'approved_overtime_hours',
	'overtime_consented_at',
	'incentive_hours',
	'banked_overtime_hours',
	'banked_overtime_band',
	'worked_intervals',
	'worksite',
	'facts'
] as const;

const REVIEWERS = ['HR Manager', 'Senior Management'] as const;

/** A new day is reviewed when it arrives carrying attendance (`[]` is a claim too; null is a plan only). */
export const ROSTER_ENTRY_CREATE_APPROVAL = {
	match: { record: { worked_intervals: { isNull: false } } },
	steps: [['L1 Manager', 'HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;
/** An edit is reviewed when it touches the clock, not when it only moves the plan. */
export const ROSTER_ENTRY_UPDATE_APPROVAL = {
	match: { changed: ['worked_intervals'] },
	steps: [['L1 Manager', 'HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;

/** A person's time off: the direct manager, or HR. */
export const LEAVE_APPROVAL = {
	steps: [['L1 Manager', 'HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;
/** A claim a person raises about themselves. */
export const CLAIM_APPROVAL = {
	steps: [['HQ Payroll HR', 'HR Manager', 'Senior Management']],
	superceded_by: REVIEWERS
} as const;
/** Pay an HR controller raises (ad hoc pay, loan instalments) is held for the HR Manager. */
export const PAY_APPROVAL = {
	steps: [['HR Manager', 'Senior Management']],
	superceded_by: ['Senior Management']
} as const;
/** A payroll run an HR controller creates is held for the HR Manager. */
export const CONTROLLER_RUN_APPROVAL = PAY_APPROVAL;
/** Seal or void of a settings version: HR Manager reviews; Senior Management writes through. */
export const SETTINGS_LIFECYCLE_APPROVAL = {
	match: { changed: ['sealed_at', 'voided_at'] },
	steps: [['HR Manager', 'Senior Management']],
	superceded_by: ['Senior Management']
} as const;

/** The jurisdiction records every rank reads: the version, its rules and its catalogues. */
export const JURISDICTION_READ = {
	jurisdiction_settings: { read: true },
	rule_set: { read: true },
	statutory_contribution_catalog: { read: true },
	adhoc_catalog: { read: true },
	allowance_catalog: { read: true },
	claim_catalog: { read: true },
	leave_catalog: { read: true },
	loan_catalog: { read: true },
	work_catalog: { read: true },
	suspension_kind: { read: true }
} as const;

/** Editing jurisdiction settings: drafts are created unsealed; a live (not voided) version may be sealed, shortened, or voided. */
const DRAFT_ROW = { read: true, create: DRAFT_SETTINGS_ROW, update: DRAFT_SETTINGS_ROW } as const;
export const JURISDICTION_EDIT = {
	jurisdiction_settings: {
		read: true,
		create: DRAFT_VERSION,
		update: {
			previous: { voided_at: { isNull: true } },
			approval: SETTINGS_LIFECYCLE_APPROVAL
		}
	},
	rule_set: DRAFT_ROW,
	statutory_contribution_catalog: DRAFT_ROW,
	adhoc_catalog: DRAFT_ROW,
	allowance_catalog: DRAFT_ROW,
	claim_catalog: DRAFT_ROW,
	leave_catalog: DRAFT_ROW,
	loan_catalog: DRAFT_ROW,
	work_catalog: DRAFT_ROW,
	suspension_kind: DRAFT_ROW
} as const;

/** What a payroll run's own build writes: the payslips, their entry and roster pins, the run's hash and warnings. */
export const PAYSLIP_BUILD_FIELDS = [
	'payroll_run_id',
	'employment_id',
	'salary_from',
	'salary_to',
	'terms_through',
	'service_basis',
	'base',
	'proration',
	'statutory',
	'adjustments',
	'gross',
	'total_deductions',
	'net',
	'employer_cost',
	'currency',
	'status'
] as const;

/** Every app of the HR controller group. */
export const HR_APPS = ['hr_controller', 'hr_employee'] as const;

/** Today's per-member budget: 600 collection calls a minute, 100 agent turns an hour. */
export const MEMBER_LIMITS = { act: '600/min', read: '600/min', agent: '100/h' } as const;
/** An automation's budget. */
export const AUTOMATION_LIMITS = { act: '600/min', read: '600/min' } as const;

export const LEAVE_ENTRY_QUERIES = ['leave_balances', 'leave_days', 'preview_leave'] as const;

/** Self-service: a person's own records, their own time off and claims (reviewed), every jurisdiction record. */
export const SELF = {
	employment_profile: { read: OWN_EMPLOYEE },
	employment_contract: { read: OWN_EMPLOYMENT },
	claim_catalog_entry: {
		read: OWN,
		create: { where: OWN, fields: CLAIM_ENTRY_FIELDS, approval: CLAIM_APPROVAL },
		update: {
			where: { ...OWN, ...UNPINNED },
			fields: CLAIM_ENTRY_EDIT,
			approval: CLAIM_APPROVAL
		},
		delete: { ...OWN, ...UNPINNED }
	},
	leave_catalog_entry: {
		read: OWN,
		create: {
			where: { ...OWN, activity: { eq: 'TIME_OFF' } },
			fields: LEAVE_ENTRY_FIELDS,
			approval: LEAVE_APPROVAL
		},
		update: {
			where: { ...OWN, ...UNPINNED },
			fields: LEAVE_ENTRY_EDIT,
			approval: LEAVE_APPROVAL
		},
		delete: { ...OWN, ...UNPINNED },
		queries: LEAVE_ENTRY_QUERIES
	},
	adhoc_catalog_entry: { read: OWN },
	loan_catalog_entry: { read: OWN },
	roster_entry: { read: OWN },
	payslip: { read: OWN },
	payroll_run: {
		read: { where: { company_id: { is: { employment_contract: { some: OWN_EMPLOYMENT } } } } }
	},
	entity: { read: true },
	holiday: { read: true },
	shift_pattern: { read: true },
	shift_definition: { read: true },
	...JURISDICTION_READ
} as const;

/** The stored files a staff rank may open: evidence on obligations and tasks, and enrolment photos. */
export const STAFF_FILES = {
	sys_file: {
		read: {
			where: {
				field: {
					in: [
						'obligation.evidence_file',
						'regulatory_task.evidence_file',
						'employment_profile.face_photo'
					]
				}
			},
			fields: ['id', 'field', 'size', 'sha256', 'approval_id', 'created_at']
		}
	}
} as const;

/** Every record, read-only: what a reviewing rank sees before it approves. */
export const STAFF_READ = {
	...JURISDICTION_READ,
	...STAFF_FILES,
	entity: { read: true },
	holiday: { read: true },
	shift_pattern: { read: true },
	shift_definition: { read: true },
	employment_profile: { read: true },
	employment_contract: { read: true },
	roster: { read: true },
	roster_entry: { read: true },
	adhoc_catalog_entry: { read: true },
	claim_catalog_entry: { read: true },
	leave_catalog_entry: { read: true, queries: LEAVE_ENTRY_QUERIES },
	loan_catalog_entry: { read: true },
	payroll_run: { read: true },
	payslip: { read: true },
	obligation: { read: true },
	regulatory_task: { read: true },
	workplace_case: { read: true },
	work_suspension: { read: true }
} as const;

/** One entry family as HR keeps it: raised (reviewed when `approval` is given), edited and withdrawn until a run settles it. */
const hrEntries = <
	F extends readonly string[],
	E extends readonly string[],
	A extends object | undefined
>(
	fields: F,
	edit: E,
	approval: A
) =>
	({
		read: true,
		create: { fields, ...(approval === undefined ? {} : { approval }) },
		update: {
			previous: UNPINNED,
			where: { or: [UNPINNED, PINNED] },
			fields: [...edit, 'payslip_id']
		},
		delete: UNPINNED
	}) as const;

/** HR administration: people, contracts, the roster, holidays, entities and every entry family. */
export const HR_ADMIN = {
	...STAFF_READ,
	...JURISDICTION_EDIT,
	entity: { read: true, create: true, update: true },
	holiday: { read: true, create: true, update: true },
	shift_pattern: { read: true, create: true, update: true },
	shift_definition: { read: true, create: true, update: true },
	employment_profile: { read: true, create: true, update: true, actions: ['anonymise'] },
	employment_contract: { read: true, create: true, update: true },
	roster: { read: true, create: true, update: true },
	roster_entry: {
		read: true,
		create: { fields: ROSTER_ENTRY_FULL_FIELDS, approval: ROSTER_ENTRY_CREATE_APPROVAL },
		update: {
			previous: UNPINNED,
			where: { or: [UNPINNED, PINNED] },
			fields: [...ROSTER_ENTRY_FULL_FIELDS, 'payslip_id'],
			approval: ROSTER_ENTRY_UPDATE_APPROVAL
		},
		delete: UNPINNED
	},
	claim_catalog_entry: hrEntries(CLAIM_ENTRY_FIELDS, CLAIM_ENTRY_EDIT, undefined),
	leave_catalog_entry: {
		...hrEntries(LEAVE_ENTRY_FIELDS, LEAVE_ENTRY_EDIT, undefined),
		queries: LEAVE_ENTRY_QUERIES
	},
	obligation: {
		read: true,
		create: {
			fields: [
				'duty_code',
				'authority',
				'trigger_ref',
				'triggered_on',
				'due_on',
				'amount_due',
				'occurrence_key',
				'company_id',
				'settings_id',
				'facts'
			]
		},
		update: true,
		// withdrawn with the run that raised it
		delete: { state: { eq: 'OPEN' } }
	},
	regulatory_task: {
		read: true,
		create: {
			fields: [
				'code',
				'title',
				'authority',
				'subject_collection',
				'subject_id',
				'trigger_ref',
				'triggered_on',
				'due_on',
				'occurrence_key',
				'company_id',
				'settings_id',
				'facts'
			]
		},
		update: true
	},
	workplace_case: { read: true, create: true, update: true },
	work_suspension: { read: true, create: true, update: true, delete: true }
} as const;
export const HR_ENTRIES_REVIEWED = {
	adhoc_catalog_entry: hrEntries(ADHOC_ENTRY_FIELDS, ADHOC_ENTRY_EDIT, PAY_APPROVAL),
	loan_catalog_entry: hrEntries(LOAN_ENTRY_FIELDS, LOAN_ENTRY_EDIT, PAY_APPROVAL)
} as const;
export const HR_ENTRIES_DIRECT = {
	adhoc_catalog_entry: hrEntries(ADHOC_ENTRY_FIELDS, ADHOC_ENTRY_EDIT, undefined),
	loan_catalog_entry: hrEntries(LOAN_ENTRY_FIELDS, LOAN_ENTRY_EDIT, undefined)
} as const;

const RUN_FIELDS = ['company_id', 'period', 'kind', 'sources', 'pay_due_date'] as const;
/** Payroll authority: runs created without review, deleted while unpaid, payslips held and paid. */
export const PAYROLL_EXPORT_QUERIES = ['export_payroll'] as const;

export const PAYROLL_AUTHORITY = {
	payroll_run: {
		read: true,
		create: { fields: RUN_FIELDS },
		update: { fields: ['pay_due_date', 'configuration_hash', 'warnings'] },
		delete: true,
		queries: PAYROLL_EXPORT_QUERIES
	},
	payslip: {
		read: true,
		create: { fields: PAYSLIP_BUILD_FIELDS },
		update: { fields: ['status', 'paid_at'] },
		moves: { status: ['DRAFT->ON_HOLD', 'ON_HOLD->DRAFT', 'DRAFT->PAID', 'ON_HOLD->PAID'] }
	}
} as const;
/** A controller's run is held for the HR Manager; the controller's build still writes the payslips. */
export const PAYROLL_CONTROLLER = {
	payroll_run: {
		read: true,
		create: { fields: RUN_FIELDS, approval: CONTROLLER_RUN_APPROVAL },
		update: { fields: ['configuration_hash', 'warnings'] },
		queries: PAYROLL_EXPORT_QUERIES
	},
	payslip: { read: true, create: { fields: PAYSLIP_BUILD_FIELDS } }
} as const;
