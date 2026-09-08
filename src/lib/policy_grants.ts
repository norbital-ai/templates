import { approveBy, noApproval } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Policy } from '../access/policies/$types.js';

type Grants = Policy['grants'];
type Collection = keyof Grants & string;
type CollectionGrants<C extends Collection> = NonNullable<Grants[C]>;
type MutateGrants<C extends Collection> =
	CollectionGrants<C> extends {
		readonly mutate?: infer M;
	}
		? NonNullable<M>
		: never;
type Action<C extends Collection> =
	| (Exclude<keyof CollectionGrants<C>, 'mutate'> & string)
	| `mutate.${keyof MutateGrants<C> & string}`;
type Grant<C extends Collection, A extends Action<C>> = A extends keyof CollectionGrants<C>
	? NonNullable<CollectionGrants<C>[A]>
	: A extends `mutate.${infer P}`
		? P extends keyof MutateGrants<C>
			? NonNullable<MutateGrants<C>[P]>
			: never
		: never;

/**
 * A collection's grants as the merge handles them: named actions, and one nested `mutate` map.
 *
 * `mutate` is spelled out rather than left to the index signature so the nested map arrives typed.
 * Reading it off `Record<string, unknown>` produced an `unknown` that every write had to cast back.
 */
type ActionGrants = Record<string, unknown> & { mutate?: Record<string, unknown> };

/**
 * Combines disjoint grant coordinates. A duplicate is an authoring error, never a merge.
 * `mutate.new` and `mutate.existing` are distinct coordinates nested beneath one `mutate` key.
 */
const addCollectionGrants = (
	merged: Record<string, ActionGrants>,
	collection: string,
	actions: ActionGrants | undefined
): void => {
	const target = (merged[collection] ??= {});
	const { mutate, ...directActions } = actions ?? {};
	for (const [action, grant] of Object.entries(directActions)) {
		if (Object.hasOwn(target, action)) {
			throw new TypeError('Duplicate policy grant ' + collection + '.' + action + '.');
		}
		target[action] = grant;
	}
	if (mutate === undefined) return;
	const targetMutate = (target.mutate ??= {});
	for (const [phase, phaseGrant] of Object.entries(mutate)) {
		if (Object.hasOwn(targetMutate, phase)) {
			throw new TypeError('Duplicate policy grant ' + collection + '.mutate.' + phase + '.');
		}
		targetMutate[phase] = phaseGrant;
	}
};

export const mergeGrants = (...parts: ReadonlyArray<Grants>): Grants => {
	const merged: Record<string, ActionGrants> = {};
	for (const part of parts) {
		for (const [collection, actions] of Object.entries(part)) {
			addCollectionGrants(merged, collection, actions);
		}
	}
	return merged as Grants;
};

export const grantOn = <const C extends Collection, const A extends Action<C>>(
	collection: C,
	action: A,
	grant: Grant<C, A>
): Grants => {
	const [operation, phase] = action.split('.');
	return {
		[collection]:
			operation === 'mutate' && phase !== undefined
				? { mutate: { [phase]: grant } }
				: { [operation]: grant }
	} as Grants;
};

export const grantsOn = <const C extends Collection>(
	collection: C,
	actions: ReadonlyArray<Action<C>>
): Grants =>
	({
		[collection]: actions.reduce<ActionGrants>((grants, action) => {
			const [operation, phase] = action.split('.');
			if (operation === 'mutate' && phase !== undefined) {
				const mutate = (grants.mutate ??= {});
				mutate[phase] = {};
			} else {
				grants[operation] = {};
			}
			return grants;
		}, {})
	}) as Grants;

const SUBJECT_EMAIL = { $subject: 'email' } as const;

/** The employee row owning an employment, matched with the registered case-fold transform. */
export const OWN_EMPLOYMENT = {
	employment_employee: {
		some: { email: { caseFoldEq: SUBJECT_EMAIL } }
	}
} as const;

/** Payslip ownership uses the exact compiled relation identity, never an inferred foreign key. */
const OWN_PAYSLIP = {
	payslip_employment: { some: OWN_EMPLOYMENT }
} as const;

/** The entity's own rows: its identity, its roster codes and its shift patterns (site operations, never rules). */
export const referenceGrants = (
	...actions: ReadonlyArray<'read' | 'mutate.new' | 'mutate.existing' | 'delete'>
): Grants =>
	mergeGrants(
		grantsOn('companies', actions),
		grantsOn('shift_definitions', actions),
		grantsOn('shift_patterns', actions)
	);

/** The law as every rank reads it: the settings versions, their schemes and bands. */
export const statutoryGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('jurisdiction_settings', actions),
		grantsOn('statutory_contributions', actions),
		grantsOn('contribution_rates', actions)
	);

const EMPLOYMENT_STATUTORY_FACT_FIELDS = [
	'employment_id',
	'statutory_contribution_id',
	'status',
	'effective_range'
] as const;

/**
 * Human statutory-fact authority excludes `supersedes_fact_id` in both write directions.
 *
 * That field is the system worker's instruction to stage a predecessor close. Letting a form or an
 * agent supply it would turn an ordinary edit into a second write. The dedicated static-identity
 * policy owns that one extra `mutate.new` field and routes the resulting graph through HR approval.
 */
const employmentStatutoryFactGrants = (
	...actions: ReadonlyArray<'read' | 'mutate.new' | 'mutate.existing' | 'delete'>
): Grants =>
	mergeGrants(
		...(actions.includes('read') ? [grantsOn('employment_statutory_facts', ['read'])] : []),
		...(actions.includes('mutate.new')
			? [
					grantOn('employment_statutory_facts', 'mutate.new', {
						fields: EMPLOYMENT_STATUTORY_FACT_FIELDS
					})
				]
			: []),
		...(actions.includes('mutate.existing')
			? [
					grantOn('employment_statutory_facts', 'mutate.existing', {
						fields: EMPLOYMENT_STATUTORY_FACT_FIELDS
					})
				]
			: []),
		...(actions.includes('delete') ? [grantsOn('employment_statutory_facts', ['delete'])] : [])
	);

export const peopleGrants = (
	...actions: ReadonlyArray<'read' | 'mutate.new' | 'mutate.existing' | 'delete'>
): Grants =>
	mergeGrants(
		grantsOn('employees', actions),
		grantsOn('employments', actions),
		...(actions.includes('read') ? [grantsOn('employment_contract_inputs', ['read'])] : []),
		grantsOn('employment_terms', actions),
		employmentStatutoryFactGrants(...actions)
	);

export const payrollGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('payroll_runs', actions),
		grantsOn('payslips', actions),
		grantsOn('payslip_adjustments', actions)
	);

/** Leave pickers need paid-period boundaries, without payroll inputs or results. */
export const leaveCalendarGrants = (ownCompany = false): Grants =>
	grantOn('payroll_runs', 'read', {
		fields: ['company_id', 'period', 'lifecycle', 'attendance_from', 'attendance_to'],
		...(ownCompany
			? {
					where: { payroll_run_company: { some: { employment_company: { some: OWN_EMPLOYMENT } } } }
				}
			: {})
	});

/**
 * The columns a captured input is *made of*, as opposed to what it paid.
 *
 * A capture names its source and the period that holds it, and nothing else on the row is a fact a
 * lower rank needs. The junction collections carry no amounts, but the source id alone is the
 * settlement claim — which is the whole of what the lock refusal reads.
 */
/** The adjustment-side claim fields: which payslip, which input link, which period. */
const ADJUSTMENT_CLAIM_FIELDS = ['id', 'payslip_id', 'input', 'period'] as const;
/** The work-day capture, as the lock refusal reads it. */
const WORK_DAY_CAPTURE_FIELDS = ['id', 'payslip_id', 'period', 'work_day_id'] as const;
/** The component-entry claim, as the lock refusal reads it. */
const CLAIM_CAPTURE_FIELDS = ['id', 'payslip_id', 'period', 'claim_request_id'] as const;
const ALLOWANCE_CAPTURE_FIELDS = ['id', 'payslip_id', 'period', 'allowance_request_id'] as const;
const PAYMENT_CAPTURE_FIELDS = ['id', 'payslip_id', 'period', 'payment_request_id'] as const;
/** The leave-request capture's columns. */
const LEAVE_CAPTURE_FIELDS = ['id', 'payslip_id', 'period', 'leave_entry_id'] as const;
/** The loan-repayment capture's columns. */
const REPAYMENT_CAPTURE_FIELDS = ['id', 'payslip_id', 'period', 'loan_repayment_id'] as const;

/**
 * Read access to the captured inputs themselves, and to nothing else on the row.
 *
 * The apps read the four junctions as the person using them: My leave and My attendance mark a
 * day or an entry consumed by a payslip, and the Scheduling board marks captured days. Each
 * junction exposes only its own source column and the period, which is the whole of what a
 * surface shows. The hooks that refuse a settled record read the same junctions as the workspace
 * and need nothing from here.
 *
 * Split from `settlementLedgerGrants` because the payroll ranks read `payslip_adjustments` whole
 * (they render payslips), so handing them the masked adjustment read too would be a duplicate
 * grant; the junction reads are the part every rank whose app shows captures still needs.
 */
export const captureLedgerGrants = (): Grants =>
	mergeGrants(
		grantOn('holiday_calendar_inputs', 'read', {
			fields: ['jurisdiction_code', 'date', 'calendar_id']
		}),
		grantOn('payslip_work_day_inputs', 'read', { fields: WORK_DAY_CAPTURE_FIELDS }),
		grantOn('payslip_claim_request_inputs', 'read', { fields: CLAIM_CAPTURE_FIELDS }),
		grantOn('payslip_allowance_request_inputs', 'read', { fields: ALLOWANCE_CAPTURE_FIELDS }),
		grantOn('payslip_payment_request_inputs', 'read', { fields: PAYMENT_CAPTURE_FIELDS }),
		grantOn('payslip_leave_inputs', 'read', { fields: LEAVE_CAPTURE_FIELDS }),
		grantOn('payslip_loan_repayment_inputs', 'read', { fields: REPAYMENT_CAPTURE_FIELDS })
	);

/**
 * What deleting a payroll run takes down with it.
 *
 * A caller's cascade descends as the caller's (RFC 0003 §3.2): the `cascade(...)` edges from a run
 * to its payslips, from a payslip to its adjustments and to the four capture junctions are
 * authorized against the deleting person's own delete grant on each collection, exactly as a
 * nested row they submitted would be. So whoever may delete a run holds delete on what the run
 * owns, and nothing else on those collections: the rows themselves are only ever written by the
 * run's `before` hook, as the workspace.
 */
export const payrollRunCascadeGrants = (): Grants =>
	mergeGrants(
		grantsOn('payslips', ['delete']),
		grantsOn('payslip_adjustments', ['delete']),
		grantsOn('payslip_work_day_inputs', ['delete']),
		grantsOn('payslip_claim_request_inputs', ['delete']),
		grantsOn('payslip_allowance_request_inputs', ['delete']),
		grantsOn('payslip_payment_request_inputs', ['delete']),
		grantsOn('payslip_leave_inputs', ['delete']),
		grantsOn('payslip_loan_repayment_inputs', ['delete'])
	);

const settlementLedgerGrants = (): Grants =>
	mergeGrants(
		grantOn('payslip_adjustments', 'read', { fields: ADJUSTMENT_CLAIM_FIELDS }),
		captureLedgerGrants()
	);

export const employeeReferenceGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('companies', actions),
		grantsOn('jurisdiction_holiday_calendars', actions),
		grantsOn('shift_definitions', actions),
		// The base an employee's own days are projected from; read in full, like the codes it names.
		grantsOn('shift_patterns', actions),
		grantsOn('claim_catalogue', actions),
		grantsOn('allowance_catalogue', actions),
		grantsOn('payment_catalogue', actions),
		grantsOn('loan_catalogue', actions),
		grantsOn('work_catalogue', actions),
		grantsOn('leave_catalogue', actions)
	);

const HQ_PAYROLL_HR_TEAM = 'HQ Payroll HR' as const;
const HR_MANAGER_TEAM = 'HR Manager' as const;
const L1_MANAGER_TEAM = 'L1 Manager' as const;
const SENIOR_MANAGEMENT_TEAM = 'Senior Management' as const;

/**
 * Sealing and voiding are the reviewed acts; a draft edit is not.
 *
 * The write that sets `sealed_at` (on a new row or an existing draft) or `voided_at` is the write
 * being reviewed, and a controller editing a draft is preparing a version nobody has endorsed
 * yet. `superceded_by` is already the senior-management route the other review flows use.
 */
const settingsSealApproval = {
	flow: ({
		record,
		changes
	}: {
		readonly record?: Readonly<{ sealed_at?: unknown; voided_at?: unknown }>;
		readonly changes?: Readonly<Record<string, unknown>>;
	}) =>
		changes?.sealed_at != null ||
		changes?.voided_at != null ||
		(changes == null && (record?.sealed_at != null || record?.voided_at != null))
			? approveBy(HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM)
			: noApproval,
	superceded_by: [SENIOR_MANAGEMENT_TEAM]
} as const;

/** A write that leaves the version a draft: the controller's whole authority over the root. */
const draftOnly = ({ record }: { readonly record: { sealed_at?: unknown; voided_at?: unknown } }) =>
	Effect.succeed(record.sealed_at == null && record.voided_at == null);

/**
 * The jurisdiction settings root, in two authorities.
 *
 * `'draft'` is the HR controller's: create and edit versions that stay drafts, delete drafts; a
 * write that would seal or void is refused outright, not held. `'seal'` is the HR Manager's and
 * Senior Management's: the same writes, plus sealing and voiding under approval. Neither is a way
 * around the hooks: the root's own hook freezes a sealed version and every child hook reads the
 * root as the workspace, so no policy can edit under a seal.
 */
export const settingsGrants = (authority: 'draft' | 'seal'): Grants =>
	authority === 'draft'
		? mergeGrants(
				grantOn('jurisdiction_settings', 'mutate.new', { authorize: draftOnly }),
				grantOn('jurisdiction_settings', 'mutate.existing', { authorize: draftOnly }),
				grantOn('jurisdiction_settings', 'delete', { authorize: draftOnly })
			)
		: mergeGrants(
				grantOn('jurisdiction_settings', 'mutate.new', { approval: settingsSealApproval }),
				grantOn('jurisdiction_settings', 'mutate.existing', { approval: settingsSealApproval }),
				grantsOn('jurisdiction_settings', ['delete'])
			);

/**
 * Settings authority over family catalogues and independent jurisdiction holiday inputs.
 * Catalogue hooks enforce their parent version's seal; holiday calendars enforce publication and
 * consumption seals. Holiday source configuration is editable independently of either lifecycle.
 */
export const settingsCatalogueGrants = (
	...actions: ReadonlyArray<'read' | 'mutate.new' | 'mutate.existing' | 'delete'>
): Grants => {
	// Schemes and bands are read by every rank through `statutoryGrants`; only their writes are
	// this group's, so the two groups never grant one coordinate twice.
	const writes = actions.filter((action) => action !== 'read');
	return mergeGrants(
		...(writes.length === 0 ? [] : [grantsOn('statutory_contributions', writes)]),
		...(writes.length === 0 ? [] : [grantsOn('contribution_rates', writes)]),
		grantsOn('work_catalogue', actions),
		grantsOn('leave_catalogue', actions),
		grantsOn('claim_catalogue', actions),
		grantsOn('allowance_catalogue', actions),
		grantsOn('payment_catalogue', actions),
		grantsOn('loan_catalogue', actions),
		grantsOn('jurisdiction_holiday_calendars', actions),
		grantsOn('jurisdiction_holiday_sources', actions)
	);
};

/**
 * ============================================================================
 * WORK DAYS: TWO COLLECTIONS OF AUTHORITY OVER ONE COLLECTION OF ROWS
 * ============================================================================
 *
 * `roster_entries` and `time_entries` were separate tables and therefore separate grants, and the
 * two grants said different things: the roster was configuration a controller writes freely, while
 * attendance is a payroll source and writing it is reviewed by the direct manager. Merging the
 * tables would have merged the grants, and one grant per coordinate means one of
 * those two rules would have had to lose.
 *
 * Neither loses. The split moves off the table name and onto the two things a grant can actually
 * say about a row:
 *
 *   WHICH COLUMNS  - `fields`, so a supervisor's write cannot reach the plan at all;
 *   WHETHER REVIEWED - the approval resolver reads what is being written and asks for review only
 *                      when the write touches the clock.
 *
 * That is strictly more precise than the arrangement it replaces. A controller editing a roster
 * month is not stopped by a review that only ever existed for attendance, and a controller filling
 * in a punch is reviewed exactly as they were before.
 */

/** Which person, which day. In every write mask, or nothing could be created at all. */
const WORK_DAY_IDENTITY_FIELDS = ['employment_id', 'work_date'] as const;

/** The plan: the roster code, its provenance and its note. */
export const WORK_DAY_PLANNED_FIELDS = [
	'shift_definition_id',
	'assignment_code',
	'planned_origin',
	'planned_note'
] as const;

/** The clock. Writing any of these is what review exists for. */
export const WORK_DAY_ATTENDANCE_FIELDS = ['worked_intervals', 'break_minutes'] as const;

/** What a rank that records attendance and does not set the schedule may write. */
const WORK_DAY_ATTENDANCE_WRITE_FIELDS = [
	...WORK_DAY_IDENTITY_FIELDS,
	...WORK_DAY_ATTENDANCE_FIELDS
] as const;

/** What a rank that owns both the schedule and attendance may write. */
const WORK_DAY_FULL_WRITE_FIELDS = [
	...WORK_DAY_IDENTITY_FIELDS,
	...WORK_DAY_PLANNED_FIELDS,
	...WORK_DAY_ATTENDANCE_FIELDS
] as const;

type WorkDayNewApproval = NonNullable<Grant<'work_days', 'mutate.new'>['approval']>;
type WorkDayExistingApproval = NonNullable<Grant<'work_days', 'mutate.existing'>['approval']>;
type WorkDayDeleteAuthorize = NonNullable<Grant<'work_days', 'delete'>['authorize']>;

/**
 * A new day is reviewed when it arrives carrying attendance.
 *
 * `worked_intervals` NULL means the row is a plan and nothing has been claimed about the clock, so
 * there is nothing for the direct manager to review. An empty array is not NULL and is reviewed:
 * "this day was read and nothing was worked" is a claim about attendance like any other.
 */
const workDayNewApproval: WorkDayNewApproval = {
	flow: ({ record }) =>
		record.worked_intervals == null
			? noApproval
			: approveBy(L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
};

/**
 * An edit is reviewed when it touches the clock, and not when it only moves the plan.
 *
 * Read off `changes` rather than the resulting record: a roster swap on a day that already carries
 * attendance leaves the attendance exactly as the reviewer last saw it, and asking for the same
 * signature again is how a review becomes noise people learn to click through.
 */
const workDayExistingApproval: WorkDayExistingApproval = {
	flow: ({ changes }) =>
		WORK_DAY_ATTENDANCE_FIELDS.some((field) => Object.hasOwn(changes, field))
			? approveBy(L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM)
			: noApproval,
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
};

/**
 * A rank that may not write the plan may not delete a day that carries one.
 *
 * There is no `fields` mask on a delete - a delete takes the whole row - so the boundary has to be
 * stated as a decision about the row instead. Removing attendance from a rostered day is a
 * `mutate.existing` that clears `worked_intervals`, and that mutation is reviewed like every other
 * attendance write.
 */
const attendanceOnlyRow: WorkDayDeleteAuthorize = ({ record }) =>
	record.shift_definition_id == null;

/**
 * Record attendance, never the schedule. The approval resolver above makes every write this mask
 * permits a reviewed one, because every field it permits is a clock field.
 */
export const attendanceWriteGrants = (
	...actions: ReadonlyArray<'mutate.new' | 'mutate.existing' | 'delete'>
): Grants =>
	mergeGrants(
		...(actions.includes('mutate.new')
			? [
					grantOn('work_days', 'mutate.new', {
						fields: WORK_DAY_ATTENDANCE_WRITE_FIELDS,
						approval: workDayNewApproval
					})
				]
			: []),
		...(actions.includes('mutate.existing')
			? [
					grantOn('work_days', 'mutate.existing', {
						fields: WORK_DAY_ATTENDANCE_WRITE_FIELDS,
						approval: workDayExistingApproval
					})
				]
			: []),
		...(actions.includes('delete')
			? [grantOn('work_days', 'delete', { authorize: attendanceOnlyRow })]
			: [])
	);

/** Own both sides of the day: publish the schedule, and record what happened against it. */
export const workDayWriteGrants = (): Grants =>
	mergeGrants(
		grantOn('work_days', 'mutate.new', {
			fields: WORK_DAY_FULL_WRITE_FIELDS,
			approval: workDayNewApproval
		}),
		grantOn('work_days', 'mutate.existing', {
			fields: WORK_DAY_FULL_WRITE_FIELDS,
			approval: workDayExistingApproval
		}),
		grantsOn('work_days', ['delete'])
	);

const leaveApproval = {
	flow: () => approveBy(L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
} as const;

const LEAVE_ENTRY_FIELDS = [
	'employment_id',
	'leave_catalogue_id',
	'event',
	'reference',
	'certificate_file'
] as const;

/** One grant owns every HR Leave category; its approval route depends on the submitted activity. */
export const hrLeaveEntryGrant = (reviewManual: boolean): Grants =>
	grantOn('leave_entries', 'mutate.new', {
		fields: LEAVE_ENTRY_FIELDS,
		approval: {
			flow: ({ record }) =>
				isLeaveTimeOffEvent(record)
					? approveBy(L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM)
					: reviewManual
						? approveBy(HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM)
						: noApproval,
			superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
		}
	});

export const timeOffEntryGrant = (): Grants =>
	grantOn('leave_entries', 'mutate.new', {
		fields: LEAVE_ENTRY_FIELDS,
		authorize: ({ record }) => Effect.succeed(isLeaveTimeOffEvent(record)),
		approval: leaveApproval
	});

const claimApproval = {
	flow: () => approveBy(HQ_PAYROLL_HR_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
} as const;

export const payrollRunApprovalFromController = {
	flow: () => approveBy(HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [SENIOR_MANAGEMENT_TEAM]
} as const;

const employmentBelongsToRequestor = (
	employmentId: string,
	api: Parameters<NonNullable<Grant<'work_days', 'mutate.new'>['authorize']>>[1]
) =>
	Effect.gen(function* () {
		const employment = yield* api.db.employments.findFirst({
			where: { id: { eq: employmentId } }
		});
		if (employment === undefined) return false;
		const employee = yield* api.db.employees.findFirst({
			where: { id: { eq: employment.employee_id } }
		});
		return employee?.email?.toLocaleLowerCase() === api.requestor.email?.toLocaleLowerCase();
	});

/**
 * A person may record their own attendance, and nothing about the schedule.
 *
 * The field mask is what stops the second half. Without it, merging the roster into `work_days`
 * would have handed every employee the ability to write their own roster code on a day they punched
 * - authority nobody on the ladder had before, arriving purely because two tables became one.
 */
export const employeeWorkDayNewGrant = (): Grants =>
	grantOn('work_days', 'mutate.new', {
		fields: WORK_DAY_ATTENDANCE_WRITE_FIELDS,
		authorize: ({ record }, api) => employmentBelongsToRequestor(record.employment_id, api),
		approval: workDayNewApproval
	});

/**
 * Add attendance to an existing person-day belonging to the requestor.
 *
 * Unlike `mutate.new`, `mutate.existing` does not need the employment or date in its field mask:
 * the stored row already owns both, and accepting either in the patch would let self-service move somebody's day.
 * The authorization runs against the complete resulting record, so a row id from another
 * employment is refused even though the submitted patch contains only clock fields.
 */
export const employeeWorkDayExistingGrant = (): Grants =>
	grantOn('work_days', 'mutate.existing', {
		fields: WORK_DAY_ATTENDANCE_FIELDS,
		authorize: ({ record }, api) => employmentBelongsToRequestor(record.employment_id, api),
		approval: workDayExistingApproval
	});

/** Whether the write's candidate event is the one request an ordinary rank may raise. */
function isLeaveTimeOffEvent(record: { readonly event?: unknown }): boolean {
	const event = record.event;
	if (event == null || typeof event !== 'object') return false;
	return Reflect.get(event, 'kind') === 'TIME_OFF';
}

export const employeeLeaveRequestNewGrant = (): Grants =>
	grantOn('leave_entries', 'mutate.new', {
		fields: LEAVE_ENTRY_FIELDS,
		// The one request an ordinary rank may raise: time off, about themselves.
		authorize: ({ record }, api) =>
			isLeaveTimeOffEvent(record)
				? employmentBelongsToRequestor(record.employment_id, api)
				: Effect.succeed(false),
		approval: leaveApproval
	});

/** Personal reads and a claim `mutate.new` validated against the prepared JS candidate. */
export const employeeSelfServiceGrants = (): Grants =>
	mergeGrants(
		grantOn('payslips', 'read', {
			where: OWN_PAYSLIP
		}),
		grantOn('claim_requests', 'mutate.new', {
			// The one thing an ordinary rank may raise: a claim, about themselves. A standing
			// allowance, a payment, an arrears settlement and an HR correction are authority the HR
			// policies hold and this one never adds — and now that each is its own collection, that
			// is a grant on a collection, which is what the access system is for. It used to be a
			// `Reflect.get(event, 'kind') === 'CLAIM'` reach into a jsonb discriminator, because the
			// five families shared one table and the grant had no other way to name one of them.
			authorize: ({ record }, api) => employmentBelongsToRequestor(record.employment_id, api),
			approval: claimApproval
		}),
		settlementLedgerGrants()
	);
