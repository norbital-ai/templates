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

/**
 * The corrections HR raises about somebody's pay, which the ranks below HR policy never see.
 *
 * A manual correction is a `MANUAL_ADJUSTMENT` event on a component entry, and `event` is one
 * jsonb column whose discriminator is the union's own `kind` — a single-level key read, which is
 * what the removed `obligations` model could not say with its nested `terms -> occasion` path. The predicate stays null-safe the same way `IS DISTINCT FROM` always was: every arm that
 * is not a correction holds a different kind, and reads as visible.
 */
export const NOT_A_CORRECTION = {
	event: {
		jsonPath: {
			path: ['kind'],
			type: 'string',
			ne: 'MANUAL_ADJUSTMENT'
		}
	}
} as const;

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

export const referenceGrants = (
	...actions: ReadonlyArray<'read' | 'mutate.new' | 'mutate.existing' | 'delete'>
): Grants =>
	mergeGrants(
		grantsOn('companies', actions),
		grantsOn('company_holidays', actions),
		grantsOn('shift_definitions', actions),
		grantsOn('pay_components', actions),
		grantsOn('leave_types', actions)
	);

export const statutoryGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('jurisdictions', actions),
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
		grantsOn('employment_terms', actions),
		employmentStatutoryFactGrants(...actions),
		// Child facts are what statutory leave floors scale on. `preview_leave` and the leave-request
		// write hook both read them; a policy that can create leave without this read turns that
		// preview into AccessDenied instead of a picker.
		...(actions.includes('read') ? [grantsOn('employee_children', ['read'])] : [])
	);

export const payrollGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('payroll_runs', actions),
		grantsOn('payslips', actions),
		grantsOn('payslip_adjustments', actions)
	);

/**
 * Write access to the payroll result, for whoever may run payroll.
 *
 * The engine builds inside `payroll_runs.mutate.prepare` and `mutate.before`, and a `before` hook
 * runs as the **requesting subject** — not elevated, the way the old after hook was. So the person
 * who asks for a payroll is the person whose authority its payslips are written under, and without
 * these grants a run refuses on its own output.
 *
 * That is a narrower arrangement than it looks, and narrower than the one it replaces:
 *
 *  - `payroll_runs.mutate.new` is what confers it in practice. There is no surface anywhere in this
 *    workspace that creates a payslip on its own, and `createPayrollRunInput` is a closed struct —
 *    a caller cannot smuggle `payslip_payroll_run` past it, so every payslip that reaches the
 *    database was computed by the engine from approved inputs.
 *  - The deletes are unchanged in kind but no longer separate in cause. A recalculation states the
 *    run's complete set of payslips, and the ones left out are removed by that same statement; the
 *    grants that used to exist for `clearRunResults` now serve the replacement it became.
 *  - The four input junctions are engine-owned: no user policy grants writes on them anywhere in
 *    the workspace, and this mask is the only grant that does. The source columns and the
 *    denormalized period are what the engine states; the payslip id is assigned from the parent.
 */
export const payrollRebuildGrants = (): Grants =>
	mergeGrants(
		grantsOn('payslips', ['mutate.new', 'delete']),
		grantsOn('payslip_adjustments', ['mutate.new', 'delete']),
		// The four engine-owned junctions. No user policy grants writes on them anywhere else in the
		// workspace, and these masks are the only grants that do. The source column and the
		// denormalized period are what the engine states; the payslip id is assigned from the parent.
		grantOn('payslip_work_day_inputs', 'mutate.new', {
			fields: ['work_day_id', 'period']
		}),
		grantOn('payslip_work_day_inputs', 'delete', {}),
		grantOn('payslip_component_entry_inputs', 'mutate.new', {
			fields: ['component_entry_id', 'period']
		}),
		grantOn('payslip_component_entry_inputs', 'delete', {}),
		grantOn('payslip_leave_request_inputs', 'mutate.new', {
			fields: ['leave_request_id', 'period']
		}),
		grantOn('payslip_leave_request_inputs', 'delete', {}),
		grantOn('payslip_loan_repayment_inputs', 'mutate.new', {
			fields: ['loan_repayment_id', 'period']
		}),
		grantOn('payslip_loan_repayment_inputs', 'delete', {})
	);

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
const ENTRY_CAPTURE_FIELDS = ['id', 'payslip_id', 'period', 'component_entry_id'] as const;
/** The leave-request capture's columns. */
const LEAVE_CAPTURE_FIELDS = ['id', 'payslip_id', 'period', 'leave_request_id'] as const;
/** The loan-repayment capture's columns. */
const REPAYMENT_CAPTURE_FIELDS = ['id', 'payslip_id', 'period', 'loan_repayment_id'] as const;

/**
 * Read access to the captured inputs themselves, and to nothing else on the row.
 *
 * The hooks that refuse a settled record read the four junctions under the editing person's own
 * subject. Without these grants "payroll 2026-03 has already taken this record into account"
 * becomes a bare denial naming a collection they have never heard of. Each junction exposes only
 * its own source column and the period, which is the whole of what a refusal quotes.
 */
/**
 * The four capture junctions alone — the reads the lock refusals quote when they name what a run
 * took into account.
 *
 * Split from `settlementLedgerGrants` because the payroll ranks read `payslip_adjustments` whole
 * (they render payslips), so handing them the masked adjustment read too would be a duplicate
 * grant; the junction reads are the part every rank that edits captured records still needs.
 */
export const captureLedgerGrants = (): Grants =>
	mergeGrants(
		grantOn('payslip_work_day_inputs', 'read', { fields: WORK_DAY_CAPTURE_FIELDS }),
		grantOn('payslip_component_entry_inputs', 'read', { fields: ENTRY_CAPTURE_FIELDS }),
		grantOn('payslip_leave_request_inputs', 'read', { fields: LEAVE_CAPTURE_FIELDS }),
		grantOn('payslip_loan_repayment_inputs', 'read', { fields: REPAYMENT_CAPTURE_FIELDS })
	);

const settlementLedgerGrants = (): Grants =>
	mergeGrants(
		grantOn('payslip_adjustments', 'read', { fields: ADJUSTMENT_CLAIM_FIELDS }),
		captureLedgerGrants()
	);

export const employeeReferenceGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('companies', actions),
		grantsOn('company_holidays', actions),
		grantsOn('shift_definitions', actions),
		grantsOn('pay_components', actions),
		grantsOn('leave_types', actions)
	);

const HQ_PAYROLL_HR_TEAM = 'HQ Payroll HR' as const;
const HR_MANAGER_TEAM = 'HR Manager' as const;
const L1_MANAGER_TEAM = 'L1 Manager' as const;
const SENIOR_MANAGEMENT_TEAM = 'Senior Management' as const;

/**
 * A lifecycle transition ends the approval flow; an ordinary draft edit does not.
 *
 * Sealing is the readback of the reviewer's approval: the write that changes `lifecycle` to
 * SEALED, or VOIDED, is the write being reviewed, and a controller editing law members of a DRAFT
 * profile is preparing a version that nobody has endorsed yet. `superceded_by` is already the
 * senior-management route the other review flows use.
 */
const profileLifecycleApproval = {
	flow: ({ changes }: { readonly changes?: Readonly<Record<string, unknown>> }) =>
		changes?.lifecycle == null ? noApproval : approveBy(HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [SENIOR_MANAGEMENT_TEAM]
} as const;

/**
 * The statutory profile authoring surface: prepare DRAFT versions and approve them into SEALED.
 *
 * The controller submits a new profile (DRAFT by default, which is why an ordinary `mutate.new`
 * needs no review) and edits its law members; the approval resolver above asks for HR Manager only
 * when a write states a lifecycle transition, so history never sees an unendorsed SEALED row. Catalogue
 * rows of a DRAFT profile are prepared the same way; the catalogue sealing hooks refuse every
 * write on rows of a SEALED or VOIDED profile, which is the second lock the immutable-history
 * matrix requires.
 */
export const statutoryProfileGrants = (): Grants =>
	mergeGrants(
		grantOn('jurisdictions', 'mutate.new', {
			approval: {
				...profileLifecycleApproval,
				flow: ({ record }: { readonly record?: Readonly<{ lifecycle?: unknown }> }) =>
					record?.lifecycle != null && record.lifecycle !== 'DRAFT'
						? approveBy(HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM)
						: noApproval
			}
		}),
		grantOn('jurisdictions', 'mutate.existing', { approval: profileLifecycleApproval }),
		grantsOn('statutory_contributions', ['mutate.new', 'mutate.existing', 'delete']),
		grantsOn('contribution_rates', ['mutate.new', 'mutate.existing', 'delete'])
	);

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

export const leaveApproval = {
	flow: () => approveBy(L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
} as const;

const claimApproval = {
	flow: () => approveBy(HQ_PAYROLL_HR_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
} as const;

export const payrollRunApprovalFromController = {
	flow: () => approveBy(HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [SENIOR_MANAGEMENT_TEAM]
} as const;

/** Whether the write's candidate event is the one claim an ordinary rank may raise. */
function isOwnClaimEvent(record: { readonly event?: unknown }): boolean {
	const event = record.event;
	if (event == null || typeof event !== 'object') return false;
	return Reflect.get(event, 'kind') === 'CLAIM';
}

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
	grantOn('leave_requests', 'mutate.new', {
		// The one request an ordinary rank may raise: time off, about themselves.
		// Encashment and a balance adjustment are controller / payroll writes —
		// the same split `isOwnClaimEvent` draws for component entries.
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
		grantOn('component_entries', 'mutate.new', {
			// The one entry an ordinary rank may raise: a claim, about themselves, on a component
			// that takes entries. Every other arm - a standing allowance, a bonus, an arrears
			// settlement, an HR correction - is authority the HR policies hold and this one never
			// adds. The event's own discriminator decides, which is a single-level key read rather
			// than a two-level jsonb path.
			authorize: ({ record }, api) =>
				isOwnClaimEvent(record)
					? employmentBelongsToRequestor(record.employment_id, api)
					: Effect.succeed(false),
			approval: claimApproval
		}),
		settlementLedgerGrants()
	);
