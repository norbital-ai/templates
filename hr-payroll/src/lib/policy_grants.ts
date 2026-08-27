import { approveBy, noApproval } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Policy } from '../access/policies/$types.js';

type Grants = Policy['grants'];
type Collection = keyof Grants & string;
type CollectionGrants<C extends Collection> = NonNullable<Grants[C]>;
type Action<C extends Collection> = keyof CollectionGrants<C> & string;
type Grant<C extends Collection, A extends Action<C>> = NonNullable<CollectionGrants<C>[A]>;

/**
 * Combines disjoint collection/action slots. A duplicate is an authoring error, never a merge.
 */
const addCollectionGrants = (
	merged: Record<string, Record<string, unknown>>,
	collection: string,
	actions: Record<string, unknown> | undefined
): void => {
	const target = (merged[collection] ??= {});
	for (const [action, grant] of Object.entries(actions ?? {})) {
		if (Object.hasOwn(target, action)) {
			throw new TypeError('Duplicate policy grant ' + collection + '.' + action + '.');
		}
		target[action] = grant;
	}
};

export const mergeGrants = (...parts: ReadonlyArray<Grants>): Grants => {
	const merged: Record<string, Record<string, unknown>> = {};
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
): Grants => ({ [collection]: { [action]: grant } }) as Grants;

export const grantsOn = <const C extends Collection>(
	collection: C,
	actions: ReadonlyArray<Action<C>>
): Grants =>
	({
		[collection]: Object.fromEntries(actions.map((action) => [action, {}]))
	}) as Grants;

/**
 * Everything except the corrections HR raises about somebody's pay.
 *
 * An adjustment is a ONE_OFF obligation whose `occasion` is `ADJUSTMENT`, and `occasion` is a real
 * column. Arms that have no occasion at all — RECURRING, SCHEDULED, REVERSAL — hold NULL there, and
 * `IS DISTINCT FROM` reads NULL as "not an adjustment", which is the answer: a standing allowance
 * and a staff loan stay visible to the ranks that could always see them.
 *
 * This used to read `"terms"->'occasion'->>'of'`, and that is why the shape changed. A predicate
 * reaching into a JSON path is hand-rolled resolution, and — decisively — **a field grant cannot
 * mask a jsonb sub-path**. This same release introduces field grants on `work_days`; a column that
 * could never accept one is a column that has already lost the next argument.
 *
 * `$sql` rather than the structured `where`, for one reason: `{ occasion: { ne: 'ADJUSTMENT' } }`
 * compiles to `!=`, and `NULL != 'ADJUSTMENT'` is NULL, which is not true — so every arm that has
 * no occasion would vanish from the ranks that must still see it. Null-safe inequality has to be
 * spelled out.
 */
export const NOT_AN_ADJUSTMENT = {
	$sql: '"occasion" IS DISTINCT FROM \'ADJUSTMENT\''
} as const;

export const ownEmploymentChild = {
	$sql:
		'"employment_id" IN (SELECT e."id" FROM "employments" e ' +
		'JOIN "employees" p ON p."id" = e."employee_id" ' +
		'WHERE lower(p."email") = lower(${requestor.email}))'
} as const;

export const referenceGrants = (
	...actions: ReadonlyArray<'read' | 'create' | 'update' | 'delete'>
): Grants =>
	mergeGrants(
		grantsOn('companies', actions),
		grantsOn('company_holidays', actions),
		grantsOn('shift_definitions', actions),
		grantsOn('rosters', actions),
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
 * policy owns that one extra create field and routes the resulting graph through HR approval.
 */
const employmentStatutoryFactGrants = (
	...actions: ReadonlyArray<'read' | 'create' | 'update' | 'delete'>
): Grants =>
	mergeGrants(
		...(actions.includes('read') ? [grantsOn('employment_statutory_facts', ['read'])] : []),
		...(actions.includes('create')
			? [
					grantOn('employment_statutory_facts', 'create', {
						fields: EMPLOYMENT_STATUTORY_FACT_FIELDS
					})
				]
			: []),
		...(actions.includes('update')
			? [
					grantOn('employment_statutory_facts', 'update', {
						fields: EMPLOYMENT_STATUTORY_FACT_FIELDS
					})
				]
			: []),
		...(actions.includes('delete') ? [grantsOn('employment_statutory_facts', ['delete'])] : [])
	);

export const peopleGrants = (
	...actions: ReadonlyArray<'read' | 'create' | 'update' | 'delete'>
): Grants =>
	mergeGrants(
		grantsOn('employees', actions),
		grantsOn('employments', actions),
		grantsOn('employment_terms', actions),
		employmentStatutoryFactGrants(...actions)
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
 * The engine builds inside `payroll_runs.create.before` and `update.before`, and a `before` hook
 * runs as the **requesting subject** — not elevated, the way `create.after` was. So the person who
 * asks for a payroll is the person whose authority its payslips are written under, and without
 * these grants a run refuses on its own output.
 *
 * That is a narrower arrangement than it looks, and narrower than the one it replaces:
 *
 *  - `payroll_runs.create` is what confers it in practice. There is no surface anywhere in this
 *    workspace that creates a payslip on its own, and `createPayrollRunInput` is a closed struct —
 *    a caller cannot smuggle `payslip_payroll_run` past it, so every payslip that reaches the
 *    database was computed by the engine from approved inputs.
 *  - The deletes are unchanged in kind but no longer separate in cause. A recalculation states the
 *    run's complete set of payslips, and the ones left out are removed by that same statement; the
 *    grants that used to exist for `clearRunResults` now serve the replacement it became.
 */
export const payrollRebuildGrants = (): Grants =>
	mergeGrants(
		grantsOn('payslips', ['create', 'delete']),
		grantsOn('payslip_adjustments', ['create', 'delete'])
	);

/**
 * The columns a settlement claim is *made of*, as opposed to what it paid.
 *
 * `payslip_sources` was a separate collection carrying nothing but the claim, so every rank could
 * read all of it. The merged `payslip_adjustments` carries amounts, and an unrestricted read would
 * hand every employee the whole payroll. This is the field mask that keeps the refusal working
 * without that: which payslip holds the record, which record it holds, and the period to name.
 */
const SETTLEMENT_CLAIM_FIELDS = ['id', 'payslip_id', 'source', 'period'] as const;

/**
 * Read access to the settlement claim itself, and to nothing else on the row.
 *
 * The hook that refuses a settled record reads `payslip_adjustments` under the editing person's own
 * subject. Without this grant "payroll 2026-03 has already taken this record into account" becomes
 * a bare denial naming a collection they have never heard of.
 */
export const settlementLedgerGrants = (): Grants =>
	grantOn('payslip_adjustments', 'read', { fields: SETTLEMENT_CLAIM_FIELDS });

export const employeeReferenceGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('companies', actions),
		grantsOn('company_holidays', actions),
		grantsOn('shift_definitions', actions),
		grantsOn('rosters', actions),
		grantsOn('pay_components', actions),
		grantsOn('leave_types', actions)
	);

const HQ_PAYROLL_HR_TEAM = 'HQ Payroll HR' as const;
const HR_MANAGER_TEAM = 'HR Manager' as const;
const L1_MANAGER_TEAM = 'L1 Manager' as const;
const SENIOR_MANAGEMENT_TEAM = 'Senior Management' as const;

/**
 * ============================================================================
 * WORK DAYS: TWO COLLECTIONS OF AUTHORITY OVER ONE COLLECTION OF ROWS
 * ============================================================================
 *
 * `roster_entries` and `time_entries` were separate tables and therefore separate grants, and the
 * two grants said different things: the roster was configuration a controller writes freely, while
 * attendance is a payroll source and writing it is reviewed by the direct manager. Merging the
 * tables would have merged the grants, and one grant per collection/action coordinate means one of
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

/** The plan: the roster code, the month that published it, and its provenance. */
export const WORK_DAY_PLANNED_FIELDS = [
	'shift_definition_id',
	'roster_id',
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

type WorkDayCreateApproval = NonNullable<Grant<'work_days', 'create'>['approval']>;
type WorkDayUpdateApproval = NonNullable<Grant<'work_days', 'update'>['approval']>;
type WorkDayDeleteAuthorize = NonNullable<Grant<'work_days', 'delete'>['authorize']>;

/**
 * A new day is reviewed when it arrives carrying attendance.
 *
 * `worked_intervals` NULL means the row is a plan and nothing has been claimed about the clock, so
 * there is nothing for the direct manager to review. An empty array is not NULL and is reviewed:
 * "this day was read and nothing was worked" is a claim about attendance like any other.
 */
const workDayCreateApproval: WorkDayCreateApproval = {
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
const workDayUpdateApproval: WorkDayUpdateApproval = {
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
 * stated as a decision about the row instead. Removing attendance from a rostered day is an update
 * that clears `worked_intervals`, and that update is reviewed like every other attendance write.
 */
const attendanceOnlyRow: WorkDayDeleteAuthorize = ({ record }) => record.shift_definition_id == null;

/**
 * Record attendance, never the schedule. The approval resolver above makes every write this mask
 * permits a reviewed one, because every field it permits is a clock field.
 */
export const attendanceWriteGrants = (
	...actions: ReadonlyArray<'create' | 'update' | 'delete'>
): Grants =>
	mergeGrants(
		...(actions.includes('create')
			? [
					grantOn('work_days', 'create', {
						fields: WORK_DAY_ATTENDANCE_WRITE_FIELDS,
						approval: workDayCreateApproval
					})
				]
			: []),
		...(actions.includes('update')
			? [
					grantOn('work_days', 'update', {
						fields: WORK_DAY_ATTENDANCE_WRITE_FIELDS,
						approval: workDayUpdateApproval
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
		grantOn('work_days', 'create', {
			fields: WORK_DAY_FULL_WRITE_FIELDS,
			approval: workDayCreateApproval
		}),
		grantOn('work_days', 'update', {
			fields: WORK_DAY_FULL_WRITE_FIELDS,
			approval: workDayUpdateApproval
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

const employmentBelongsToRequestor = (
	employmentId: string,
	api: Parameters<NonNullable<Grant<'work_days', 'create'>['authorize']>>[1]
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
export const employeeWorkDayCreateGrant = (): Grants =>
	grantOn('work_days', 'create', {
		fields: WORK_DAY_ATTENDANCE_WRITE_FIELDS,
		authorize: ({ record }, api) => employmentBelongsToRequestor(record.employment_id, api),
		approval: workDayCreateApproval
	});

export const employeeLeaveRequestCreateGrant = (): Grants =>
	grantOn('leave_requests', 'create', {
		authorize: ({ record }, api) => employmentBelongsToRequestor(record.employment_id, api),
		approval: leaveApproval
	});

/** Personal reads and a claim create validated against the prepared JS candidate. */
export const employeeSelfServiceGrants = (): Grants =>
	mergeGrants(
		grantOn('payslips', 'read', {
			where: ownEmploymentChild,
			dependencies: ['employments', 'employees']
		}),
		grantOn('obligations', 'create', {
			authorize: ({ record }, api) =>
				Effect.gen(function* () {
					// The one obligation an ordinary rank may raise: a one-off, on the occasion of a
					// claim, about themselves. Every other arm - a standing allowance, a loan schedule,
					// an HR correction - is authority the HR policies hold and this one never adds.
					// Two plain column comparisons now, where it used to reach two levels into jsonb.
					if (record.terms !== 'ONE_OFF') return false;
					if (record.occasion !== 'CLAIM') return false;
					const employment = yield* api.db.employments.findFirst({
						where: { id: { eq: record.employment_id } }
					});
					if (employment === undefined) return false;
					const employee = yield* api.db.employees.findFirst({
						where: { id: { eq: employment.employee_id } }
					});
					return employee?.email?.toLocaleLowerCase() === api.requestor.email?.toLocaleLowerCase();
				}),
			approval: claimApproval
		})
	);
