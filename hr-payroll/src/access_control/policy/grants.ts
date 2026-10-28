import type { Actor, Flow, Id, PolicyReads, Verdict } from '@norbital-ai/bolt';
/**
 * The literals the policies share: self-service scopes, approval routes and the grant fragments several ranks repeat.
 *
 * A policy states its whole authority in its own file; this module only names the pieces several of them repeat,
 * so a route or a scope is written once. Reads are JSON layer maps; each write grant names its `columns` and one
 * `check` over the whole batch. Every business refusal that reads other rows lives in its model's transform.
 */

/** The signed-in member's own employee row: the email compares case-folded. */
const OWN_EMPLOYEE = { email: { eq: { var: 'requestor.email' } } } as const;
/** An employment whose employee is the signed-in member. */
const OWN_EMPLOYMENT = { employee_id: { is: OWN_EMPLOYEE } } as const;
/** A row about one of the member's own employments. */
const OWN = { employment_id: { is: OWN_EMPLOYMENT } } as const;

// ── what a check sees: the verdicts, and for some the actor and one workspace read ──
type Judge = {
	allow(): Verdict;
	deny(message: string): Verdict;
	approve(build: (flow: Flow) => Flow): Verdict;
};
type Reading = Judge & { readonly actor: Actor; readonly db: PolicyReads };
type Pinned = { readonly payslip_id?: string | null };
type Employed = { readonly employment_id?: Id<'employment_contract'> | null };
type Governed = { readonly settings_id?: Id<'jurisdiction_settings'> | null };
type Draft = { readonly sealed_at?: unknown; readonly voided_at?: unknown };

const SETTLED = 'A payroll run settled this entry. Delete that run to change it.';
const pinned = (rows: readonly Pinned[]) => rows.some((row) => row.payslip_id != null);

/** Whether every employment is the signed-in member's own (their employee row's email, case-folded). */
const ownsAll = function* (
	ctx: Reading,
	employments: readonly (Id<'employment_contract'> | null | undefined)[]
) {
	const email = ctx.actor.kind === 'member' ? ctx.actor.email?.toLowerCase() : undefined;
	const ids = [...new Set(employments)];
	if (email == null || ids.some((id) => id == null)) return false;
	const { employment_contract } = yield* ctx.db.query({
		employment_contract: {
			where: { id: { in: ids.filter((id): id is Id<'employment_contract'> => id != null) } },
			fields: ['employee_id']
		},
		'employment_contract.employee_id': { fields: ['email'] }
	});
	return (
		employment_contract.rows.length === ids.length &&
		employment_contract.rows.every((row) => row.employee_id?.email?.toLowerCase() === email)
	);
};
/** Whether every version is a draft: never sealed, never voided. */
const draftsAll = function* (
	ctx: Reading,
	versions: readonly (Id<'jurisdiction_settings'> | null | undefined)[]
) {
	const ids = [...new Set(versions)];
	if (ids.some((id) => id == null)) return false;
	const { jurisdiction_settings } = yield* ctx.db.query({
		jurisdiction_settings: {
			where: { id: { in: ids.filter((id): id is Id<'jurisdiction_settings'> => id != null) } },
			fields: ['sealed_at', 'voided_at']
		}
	});
	return (
		jurisdiction_settings.rows.length === ids.length &&
		jurisdiction_settings.rows.every((row) => row.sealed_at == null && row.voided_at == null)
	);
};

/** What a person may say about a new entry; the company comes from the employment, the pin from the run. */
/** Each family writes its payroll inputs; descriptive labels become payslip descriptions. */
const ADHOC_ENTRY_FIELDS = [
	'catalog_id',
	'employment_id',
	'occurred_on',
	'activity',
	'amount',
	'quantity',
	'label',
	'facts'
] as const;
const ADHOC_ENTRY_EDIT = [
	'catalog_id',
	'occurred_on',
	'activity',
	'amount',
	'quantity',
	'label',
	'facts'
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
	'facts'
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
	'facts'
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
	'label',
	'facts',
	'reference'
] as const;

const LOAN_ENTRY_FIELDS = [
	'catalog_id',
	'employment_id',
	'principal_amount',
	'repayment_period',
	'repayment_frequency',
	'facts',
	'advance_made_on'
] as const;
const LOAN_COLUMNS = {
	loan_catalog_entry: LOAN_ENTRY_FIELDS,
	'loan_catalog_entry.repayments': ['occurred_on', 'amount']
} as const;
/** Both sides of the day: the plan (roster code and overtime) and the clock. */
export const ROSTER_ENTRY_ATTENDANCE_FIELDS = [
	'employment_id',
	'work_date',
	'worked_intervals'
] as const;

const ROSTER_ENTRY_FULL_FIELDS = [
	'employment_id',
	'work_date',
	'shift_definition_id',
	'planned_overtime_hours',
	'approved_overtime_intervals',
	'overtime_consented_at',
	'banked_overtime_hours',
	'banked_overtime_band',
	'worked_intervals',
	'worksite',
	'facts'
] as const;

const REVIEWERS = ['hr_manager', 'senior_management'] as const;
const ATTENDANCE_REVIEWERS = ['manager', ...REVIEWERS] as const;
const attendanceReview = (flow: Flow) =>
	flow.step('Attendance review', { teams: ATTENDANCE_REVIEWERS }).supersededBy(REVIEWERS);
/** A person's time off is reviewed by the manager or HR. */
const leaveReview = (flow: Flow) =>
	flow.step('Leave review', { teams: ATTENDANCE_REVIEWERS }).supersededBy(REVIEWERS);
/** A claim is reviewed by payroll or HR. */
const claimReview = (flow: Flow) =>
	flow.step('Claim review', { teams: ['hr_controller', ...REVIEWERS] }).supersededBy(REVIEWERS);
/** Pay proposed by a controller needs HR Manager review. */
const payReview = (flow: Flow) =>
	flow.step('HR Manager review', { teams: REVIEWERS }).supersededBy(['senior_management']);

// ── roster attendance: a plan-only row is saved directly; a clock claim or a clock edit is reviewed ──
type Clocked = { readonly worked_intervals?: unknown };
const sameValue = (left: unknown, right: unknown) =>
	JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
/** Attendance claims require review; a plan-only row is saved directly. */
export const rosterCreateCheck = function* (rows: readonly Clocked[], ctx: Judge) {
	return rows.some((row) => row.worked_intervals != null)
		? ctx.approve(attendanceReview)
		: ctx.allow();
};
/** Moving a plan needs no review; editing its clock does. */
const rosterUpdateCheck = function* (
	changes: readonly { readonly before: Clocked & Pinned; readonly set: Clocked }[],
	ctx: Judge
) {
	return changes.some(
		({ before, set }) =>
			set.worked_intervals !== undefined &&
			!sameValue(set.worked_intervals, before.worked_intervals)
	)
		? ctx.approve(attendanceReview)
		: ctx.allow();
};
/** A supervisor edits only days no run settled; a clock edit is reviewed. */
export const rosterUnpinnedUpdateCheck = function* (
	changes: readonly { readonly before: Clocked & Pinned; readonly set: Clocked }[],
	ctx: Judge
) {
	if (pinned(changes.map(({ before }) => before))) return ctx.deny(SETTLED);
	return yield* rosterUpdateCheck(changes, ctx);
};

// ── shared checks ──
/** Only entries no run has settled change or go; a consumed one is released by deleting that payroll run. */
const unpinnedUpdate = function* (changes: readonly { readonly before: Pinned }[], ctx: Judge) {
	return pinned(changes.map(({ before }) => before)) ? ctx.deny(SETTLED) : ctx.allow();
};
const unpinnedDelete = function* (rows: readonly Pinned[], ctx: Judge) {
	return pinned(rows) ? ctx.deny(SETTLED) : ctx.allow();
};
const payReviewed = function* (_rows: readonly object[], ctx: Judge) {
	return ctx.approve(payReview);
};
/** A new version is a draft: created unsealed and live. */
const draftCreate = function* (rows: readonly Draft[], ctx: Judge) {
	return rows.every((row) => row.sealed_at == null && row.voided_at == null)
		? ctx.allow()
		: ctx.deny('A new version starts as a draft; seal it once it is reviewed.');
};
const draftDelete = function* (rows: readonly Draft[], ctx: Judge) {
	return rows.every((row) => row.sealed_at == null && row.voided_at == null)
		? ctx.allow()
		: ctx.deny('Only a draft version may be discarded; void a sealed one instead.');
};
/** A catalogue row of a draft version; a sealed version's rows are fixed. */
const DRAFT_ONLY = 'A sealed version’s rules are fixed. Clone it into a draft to change them.';
const draftRowCreate = function* (rows: readonly Governed[], ctx: Reading) {
	return (yield* draftsAll(
		ctx,
		rows.map((row) => row.settings_id)
	))
		? ctx.allow()
		: ctx.deny(DRAFT_ONLY);
};
const draftRowUpdate = function* (changes: readonly { readonly before: Governed }[], ctx: Reading) {
	return (yield* draftsAll(
		ctx,
		changes.map(({ before }) => before.settings_id)
	))
		? ctx.allow()
		: ctx.deny(DRAFT_ONLY);
};

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
	work_catalog: { read: true }
} as const;

/** A new version is created as an unsealed draft. */
export const DRAFT_VERSION_CREATE = { check: draftCreate } as const;

/** Editing jurisdiction settings: drafts are created unsealed and may be discarded; a live (not voided) version may be sealed, shortened, or voided. */
const DRAFT_ROW = {
	read: true,
	create: { check: draftRowCreate },
	update: { check: draftRowUpdate }
} as const;
const JURISDICTION_EDIT = {
	jurisdiction_settings: {
		read: true,
		create: DRAFT_VERSION_CREATE,
		update: {
			columns: {
				jurisdiction_settings: [
					'suspension_kinds',
					'code',
					'jurisdiction_code',
					'name',
					'references',
					'employee_input_schema',
					'entity_input_schema',
					'behaviours',
					'void_reason',
					'reference_tables',
					'payroll',
					'change_summary',
					'effective_range',
					'sources',
					'cloned_from_id',
					'sealed_at',
					'voided_at'
				]
			},
			/** Draft edits execute directly; sealing or voiding needs a review; a voided version is final. */
			check: function* (
				changes: readonly {
					readonly before: { readonly voided_at?: unknown };
					readonly set: { readonly sealed_at?: unknown; readonly voided_at?: unknown };
				}[],
				ctx: Judge
			) {
				if (changes.some(({ before }) => before.voided_at != null))
					return ctx.deny('A voided version is final.');
				return changes.some(({ set }) => set.sealed_at !== undefined || set.voided_at !== undefined)
					? ctx.approve(payReview)
					: ctx.allow();
			}
		},
		delete: { check: draftDelete }
	},
	rule_set: DRAFT_ROW,
	statutory_contribution_catalog: DRAFT_ROW,
	adhoc_catalog: DRAFT_ROW,
	allowance_catalog: DRAFT_ROW,
	claim_catalog: DRAFT_ROW,
	leave_catalog: DRAFT_ROW,
	loan_catalog: DRAFT_ROW,
	work_catalog: DRAFT_ROW
} as const;

/** What a payroll run's own build writes: the payslips, their entry and roster pins, the run's hash and warnings. */
const PAYSLIP_BUILD_FIELDS = [
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
	'company_payments',
	'gross',
	'total_deductions',
	'net',
	'employer_cost',
	'currency',
	'status'
] as const;

/** Every app of the HR controller group. */
export const HR_APPS = ['hr_controller', 'hr_employee'] as const;
/** What HR ranks start: drift research, anonymisation and the payroll export (bank files, salary listing). */
export const HR_AUTOMATIONS = [
	'statutory_drift',
	'employment_profile_anonymise',
	'payroll_run.sync.export'
] as const;

/** Today's per-member budget: 600 model calls a minute, 100 agent turns an hour. */
export const MEMBER_LIMITS = { act: '600/min', read: '600/min', agent: '100/h' } as const;
/** An automation's budget. */
export const AUTOMATION_LIMITS = { act: '600/min', read: '600/min' } as const;

/** A self-service entry: raised for one's own employment, then edited or withdrawn until a run settles it, each reviewed. */
const selfCreate = (review: (flow: Flow) => Flow) =>
	function* (rows: readonly Employed[], ctx: Reading) {
		return (yield* ownsAll(
			ctx,
			rows.map((row) => row.employment_id)
		))
			? ctx.approve(review)
			: ctx.deny('Raise this for your own employment.');
	};
const selfUpdate = (review: (flow: Flow) => Flow) =>
	function* (changes: readonly { readonly before: Employed & Pinned }[], ctx: Reading) {
		const before = changes.map((change) => change.before);
		if (pinned(before)) return ctx.deny(SETTLED);
		return (yield* ownsAll(
			ctx,
			before.map((row) => row.employment_id)
		))
			? ctx.approve(review)
			: ctx.deny('Change only your own entries.');
	};
const selfDelete = function* (rows: readonly (Employed & Pinned)[], ctx: Reading) {
	if (pinned(rows)) return ctx.deny(SETTLED);
	return (yield* ownsAll(
		ctx,
		rows.map((row) => row.employment_id)
	))
		? ctx.allow()
		: ctx.deny('Withdraw only your own entries.');
};

/** The columns a face enrolment writes: the descriptor, the straight-on photo, consent and its status. */
const FACE_ENROLMENT = [
	'face_embedding',
	'face_photo',
	'face_consent_at',
	'face_enrolled_at',
	'face_enrollment_status'
] as const;
/** Self-service: a person's own records, their own time off and claims (reviewed), every jurisdiction record. */
export const SELF = {
	employment_profile: {
		read: { employment_profile: { where: OWN_EMPLOYEE } },
		// a person enrols their own face for the attendance kiosk; HR approves it before the kiosk matches it
		update: {
			columns: { employment_profile: FACE_ENROLMENT },
			check: function* (
				changes: readonly {
					readonly before: { readonly email?: string | null };
					readonly set: { readonly face_enrollment_status?: string | null };
				}[],
				ctx: Reading
			) {
				const email = ctx.actor.kind === 'member' ? ctx.actor.email?.toLowerCase() : undefined;
				if (email == null || changes.some(({ before }) => before.email?.toLowerCase() !== email))
					return ctx.deny('Enrol only your own face.');
				return changes.every(({ set }) => set.face_enrollment_status === 'PENDING')
					? ctx.allow()
					: ctx.deny('A face you enrol yourself waits for HR to approve it.');
			}
		}
	},
	employment_contract: { read: { employment_contract: { where: OWN_EMPLOYMENT } } },
	claim_catalog_entry: {
		read: { claim_catalog_entry: { where: OWN } },
		create: {
			columns: { claim_catalog_entry: CLAIM_ENTRY_FIELDS },
			check: selfCreate(claimReview)
		},
		update: {
			columns: { claim_catalog_entry: CLAIM_ENTRY_EDIT },
			check: selfUpdate(claimReview)
		},
		delete: { check: selfDelete }
	},
	leave_catalog_entry: {
		read: { leave_catalog_entry: { where: OWN } },
		create: {
			columns: { leave_catalog_entry: LEAVE_ENTRY_FIELDS },
			// self-service records time off only; HR records encashments, carry-forwards and adjustments
			check: function* (
				rows: readonly (Employed & { readonly activity?: string | null })[],
				ctx: Reading
			) {
				if (rows.some((row) => (row.activity ?? 'TIME_OFF') !== 'TIME_OFF'))
					return ctx.deny('Request time off; HR records other leave movements.');
				return yield* selfCreate(leaveReview)(rows, ctx);
			}
		},
		update: {
			columns: { leave_catalog_entry: LEAVE_ENTRY_EDIT },
			check: selfUpdate(leaveReview)
		},
		delete: { check: selfDelete }
	},
	adhoc_catalog_entry: { read: { adhoc_catalog_entry: { where: OWN } } },
	loan_catalog_entry: { read: { loan_catalog_entry: { where: OWN } } },
	loan_repayment_entry: { read: { loan_repayment_entry: { where: { loan_id: { is: OWN } } } } },
	roster_entry: { read: { roster_entry: { where: OWN } } },
	payslip: { read: { payslip: { where: OWN } } },
	payroll_run: {
		read: {
			payroll_run: {
				where: { company_id: { is: { employment_contract: { some: OWN_EMPLOYMENT } } } }
			}
		}
	},
	// the entity's own employment layers show only the member's own employment (and its days and leave)
	entity: { read: { 'entity.employment_contract': { where: OWN_EMPLOYMENT } } },
	holiday: { read: true },
	shift_pattern: { read: true },
	shift_definition: { read: true },
	...JURISDICTION_READ
} as const;

/** The stored files a staff rank may open: evidence on obligations and tasks, and enrolment photos. */
const STAFF_FILES = {
	sys_file: {
		read: {
			sys_file: {
				where: {
					field: {
						in: [
							'obligation.evidence_file',
							'regulatory_task.evidence_file',
							'employment_profile.face_photo'
						]
					}
				},
				fields: ['field', 'size', 'sha256', 'created_at']
			}
		}
	}
} as const;

/** Every record, read-only: what a reviewing rank sees before it approves. */
export const STAFF_READ = {
	...JURISDICTION_READ,
	...STAFF_FILES,
	entity: { read: true },
	bank: { read: true },
	holiday: { read: true },
	shift_pattern: { read: true },
	shift_definition: { read: true },
	employment_profile: { read: true },
	employment_contract: { read: true },
	roster: { read: true },
	roster_entry: { read: true },
	adhoc_catalog_entry: { read: true },
	claim_catalog_entry: { read: true },
	leave_catalog_entry: { read: true },
	loan_catalog_entry: { read: true },
	loan_repayment_entry: { read: true },
	payroll_run: { read: true },
	payslip: { read: true },
	obligation: { read: true },
	regulatory_task: { read: true },
	workplace_case: { read: true },
	work_suspension: { read: true }
} as const;

/** HR keeps an entry family: raised (reviewed when `review` is given), edited and withdrawn until a run settles it. */
const hrEntryUpdate = { check: unpinnedUpdate } as const;
const hrEntryDelete = { check: unpinnedDelete } as const;

/** HR administration: people, contracts, the roster, holidays, entities and every entry family. */
export const HR_ADMIN = {
	...STAFF_READ,
	...JURISDICTION_EDIT,
	entity: { read: true, create: true, update: true },
	bank: { read: true, create: true, update: true },
	/** The workspace's WhatsApp numbers: an entity names its hotline, and HR deploys the payroll hotline on it. */
	sys_integration: {
		read: {
			sys_integration: { where: { integration: { eq: 'whatsapp' }, owner: { isNull: true } } }
		},
		update: {
			columns: { sys_integration: ['envoy'] },
			check: function* (
				changes: readonly {
					readonly before: { readonly integration: string; readonly owner?: unknown };
				}[],
				ctx: Judge
			) {
				return changes.every(
					({ before }) => before.integration === 'whatsapp' && before.owner == null
				)
					? ctx.allow()
					: ctx.deny('Deploy envoys only on the workspace’s WhatsApp numbers.');
			}
		}
	},
	holiday: { read: true, create: true, update: true },
	shift_pattern: { read: true, create: true, update: true },
	shift_definition: { read: true, create: true, update: true },
	employment_profile: { read: true, create: true, update: true },
	employment_contract: { read: true, create: true, update: true },
	roster: { read: true, create: true, update: true },
	roster_entry: {
		read: true,
		create: { columns: { roster_entry: ROSTER_ENTRY_FULL_FIELDS }, check: rosterCreateCheck },
		update: {
			columns: { roster_entry: [...ROSTER_ENTRY_FULL_FIELDS, 'payslip_id'] },
			check: rosterUpdateCheck
		},
		delete: hrEntryDelete
	},
	claim_catalog_entry: {
		read: true,
		create: { columns: { claim_catalog_entry: CLAIM_ENTRY_FIELDS } },
		update: {
			columns: { claim_catalog_entry: [...CLAIM_ENTRY_EDIT, 'payslip_id'] },
			...hrEntryUpdate
		},
		delete: hrEntryDelete
	},
	loan_repayment_entry: {
		read: true,
		update: { columns: { loan_repayment_entry: ['occurred_on', 'amount'] }, ...hrEntryUpdate }
	},
	leave_catalog_entry: {
		read: true,
		create: { columns: { leave_catalog_entry: LEAVE_ENTRY_FIELDS } },
		update: {
			columns: { leave_catalog_entry: [...LEAVE_ENTRY_EDIT, 'payslip_id'] },
			...hrEntryUpdate
		},
		delete: hrEntryDelete
	},
	obligation: {
		read: true,
		create: {
			columns: {
				obligation: [
					'duty_code',
					'references',
					'trigger_ref',
					'triggered_on',
					'due_on',
					'amount_due',
					'occurrence_key',
					'company_id',
					'settings_id',
					'facts'
				]
			}
		},
		update: true,
		// withdrawn with the run that raised it
		delete: {
			check: function* (rows: readonly { readonly state: string }[], ctx: Judge) {
				return rows.every((row) => row.state === 'OPEN')
					? ctx.allow()
					: ctx.deny('Only an open obligation is withdrawn.');
			}
		}
	},
	regulatory_task: {
		read: true,
		create: {
			columns: {
				regulatory_task: [
					'code',
					'title',
					'references',
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
			}
		},
		update: true
	},
	workplace_case: { read: true, create: true, update: true },
	work_suspension: { read: true, create: true, update: true }
} as const;
/** Ad hoc pay and loans a controller raises wait for an HR Manager. */
export const HR_ENTRIES_REVIEWED = {
	adhoc_catalog_entry: {
		read: true,
		create: { columns: { adhoc_catalog_entry: ADHOC_ENTRY_FIELDS }, check: payReviewed },
		update: {
			columns: { adhoc_catalog_entry: [...ADHOC_ENTRY_EDIT, 'payslip_id'] },
			...hrEntryUpdate
		},
		delete: hrEntryDelete
	},
	loan_catalog_entry: {
		read: true,
		create: { columns: LOAN_COLUMNS, check: payReviewed },
		update: { columns: LOAN_COLUMNS },
		delete: true
	}
} as const;
/** Loan terms own their repayment schedule; the transform preserves settled rows and validates the balance. */
export const HR_ENTRIES_DIRECT = {
	adhoc_catalog_entry: {
		read: true,
		create: { columns: { adhoc_catalog_entry: ADHOC_ENTRY_FIELDS } },
		update: {
			columns: { adhoc_catalog_entry: [...ADHOC_ENTRY_EDIT, 'payslip_id'] },
			...hrEntryUpdate
		},
		delete: hrEntryDelete
	},
	loan_catalog_entry: {
		read: true,
		create: { columns: LOAN_COLUMNS },
		update: { columns: LOAN_COLUMNS },
		delete: true
	}
} as const;

/** A run's payslips are its build's: the transform adds them, so a writer names only the run's own columns. */
const RUN_COLUMNS = {
	payroll_run: ['company_id', 'period', 'kind', 'sources', 'pay_due_date']
} as const;

/** Payroll ranks also hold HR schedule rights; settled repayments remain immutable. */
const PAYROLL_LOAN_REPAYMENTS = {
	read: true,
	update: {
		columns: { loan_repayment_entry: ['occurred_on', 'amount', 'payslip_id'] },
		...hrEntryUpdate
	}
} as const;

/** Payroll authority: runs created without review, deleted while unpaid, payslips held and paid. */
export const PAYROLL_AUTHORITY = {
	loan_repayment_entry: PAYROLL_LOAN_REPAYMENTS,
	payroll_run: {
		read: true,
		create: { columns: RUN_COLUMNS },
		update: { columns: { payroll_run: ['pay_due_date', 'configuration_hash', 'warnings'] } },
		delete: true
	},
	payslip: {
		read: true,
		create: { columns: { payslip: PAYSLIP_BUILD_FIELDS } },
		update: { columns: { payslip: ['status', 'paid_at', 'bank_charges'] } },
		moves: { status: ['DRAFT->ON_HOLD', 'ON_HOLD->DRAFT', 'DRAFT->PAID', 'ON_HOLD->PAID'] }
	}
} as const;
/** A controller proposes the run and its calculated payslips; the complete batch commits after HR Manager approval. */
export const PAYROLL_CONTROLLER = {
	loan_repayment_entry: PAYROLL_LOAN_REPAYMENTS,
	payroll_run: {
		read: true,
		create: { columns: RUN_COLUMNS, check: payReviewed },
		update: { columns: { payroll_run: ['configuration_hash', 'warnings'] } }
	},
	payslip: {
		read: true,
		create: { columns: { payslip: PAYSLIP_BUILD_FIELDS } },
		update: { columns: { payslip: ['bank_charges'] } }
	}
} as const;
