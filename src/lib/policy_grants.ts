import { approveBy, noApproval, type PolicyDecisionApi } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { Policy } from '../access/policies/$types.js';
import { leaveActivityOf, type LeaveEntryActivity } from './leave/activity-fields.js';
import { readRange } from '../collections/payroll_runs/lib/effective.js';
import { dateKey } from './iso-day.js';
import { capturingRuns } from './holiday-capture.js';
import { consumedTermsThrough, contractReferences } from './employment-contract.js';
import { producedMentions } from '../collections/payroll_runs/lib/mentions.js';
import { assertPayrollRunDeletable } from '../collections/payroll_runs/lib/period.js';

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
 * ============================================================================
 * DELETE DECISIONS
 * ============================================================================
 *
 * A delete has no input and no transform: what may be removed is the grant's `authorize`, judged
 * on the stored row with the workspace's reads. Every rule about removing a row lives
 * here, once, and every policy that grants the delete names it.
 */

/** A settings version is history once sealed: never deleted, only voided. */
const draftVersionOnly = ({ record }: { readonly record: { readonly sealed_at?: unknown } }) =>
	record.sealed_at == null;

/** A row of a sealed settings version is never deleted; a draft's rows go with the draft. */
const draftSettingsRow = (
	{ record }: { readonly record: { readonly settings_id: string } },
	api: PolicyDecisionApi
) =>
	Effect.map(
		api.db.jurisdiction_settings.findFirst({
			where: { id: { eq: record.settings_id } },
			columns: { sealed_at: true }
		}),
		(version) => version != null && version.sealed_at == null
	);

/** A scheme another scheme of its version still names as `produced.<code>` stays. */
const unreferencedDraftScheme = (
	{
		record
	}: {
		readonly record: { readonly id: string; readonly settings_id: string; readonly code: string };
	},
	api: PolicyDecisionApi
) =>
	Effect.gen(function* () {
		if (!(yield* draftSettingsRow({ record }, api))) return false;
		const siblings = yield* api.db.statutory_contributions.findMany({
			where: { settings_id: { eq: record.settings_id }, approval_id: { isNull: true } },
			columns: { id: true, rules: true },
			limit: 500
		});
		return !siblings.some(
			(other) => other.id !== record.id && producedMentions(other.rules).includes(record.code)
		);
	});

/** A holiday a payroll run's frozen snapshot captured is history. */
const uncapturedHoliday = (
	{ record }: { readonly record: { readonly id: string } },
	api: PolicyDecisionApi
) =>
	Effect.map(
		api.db.payroll_runs.findMany({
			columns: { id: true, period: true, holidays: true },
			limit: 20_000
		}),
		(runs) => capturingRuns(runs, record.id).length === 0
	);

/** A contract that anything references, or that an approval still names, stays. */
const unreferencedContract = (
	{ record }: { readonly record: { readonly id: string } },
	api: PolicyDecisionApi
) =>
	Effect.map(contractReferences(api.db, [record.id]), (references) => {
		const entry = references.get(record.id);
		return entry == null || (entry.sealedBy == null && !entry.pending);
	});

/** Terms that supplied consumed contract history are retained, even after the consumer is removed. */
const unconsumedTerms = (
	{
		record
	}: { readonly record: { readonly employment_id: string; readonly effective_range: unknown } },
	api: PolicyDecisionApi
) =>
	Effect.map(consumedTermsThrough(api.db, [record.employment_id]), (consumed) => {
		const through = consumed.get(record.employment_id);
		const range = readRange(record.effective_range);
		return through == null || (range != null && dateKey(range.start) > through);
	});

/** A source a payslip settled is released by deleting that draft payslip, never directly. */
const unpinned = ({ record }: { readonly record: { readonly payslip_id?: string | null } }) =>
	record.payslip_id == null;

/** A standing allowance a payslip has priced is money history: no delete takes it. */
const unpriced = (
	{ record }: { readonly record: { readonly id: string } },
	api: PolicyDecisionApi
) =>
	Effect.map(
		api.db.allowance_entries.findFirst({
			where: { derived_from_id: { eq: record.id } },
			columns: { id: true }
		}),
		(entry) => entry == null
	);

/** An agreement whose repayment a payslip settled is money history: the cascade must not take it. */
const unsettledLoan = (
	{ record }: { readonly record: { readonly id: string } },
	api: PolicyDecisionApi
) =>
	Effect.map(
		api.db.loan_repayments.findFirst({
			where: { loan_id: { eq: record.id }, payslip_id: { isNotNull: true } },
			columns: { id: true }
		}),
		(settled) => settled == null
	);

/** A run is deleted only while nobody in it has been paid, and only newest first. */
const unpaidLatestRun = (
	{
		record
	}: {
		readonly record: { readonly id: string; readonly company_id: string; readonly period: string };
	},
	api: PolicyDecisionApi
) =>
	Effect.gen(function* () {
		const [paid, siblings] = yield* Effect.all(
			[
				api.db.payslips.findFirst({
					where: { payroll_run_id: { eq: record.id }, status: { eq: 'PAID' } },
					columns: { id: true }
				}),
				api.db.payroll_runs.findMany({
					where: { company_id: { eq: record.company_id } },
					columns: { id: true, period: true },
					limit: 20_000
				})
			],
			{ concurrency: 'unbounded' }
		);
		if (paid != null) return false;
		assertPayrollRunDeletable(
			siblings.filter((run) => run.id !== record.id),
			record.period
		);
		return true;
	});

/** A paid payslip is money that left the building. */
const unpaidPayslip = ({
	record
}: {
	readonly record: { readonly status: string; readonly paid_at?: unknown };
}) => record.status !== 'PAID' && record.paid_at == null;

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
		grantsOn('statutory_contributions', actions)
	);

const EMPLOYMENT_STATUTORY_FACT_FIELDS = [
	'employee_id',
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
		grantsOn(
			'employments',
			actions.filter((action) => action !== 'delete')
		),
		grantsOn(
			'employment_terms',
			actions.filter((action) => action !== 'delete')
		),
		...(actions.includes('delete')
			? [
					grantOn('employments', 'delete', { authorize: unreferencedContract }),
					grantOn('employment_terms', 'delete', { authorize: unconsumedTerms })
				]
			: []),
		employmentStatutoryFactGrants(...actions)
	);

/** The money families and loans: every write, and a delete of anything no payslip settled. */
export const requestGrants = (): Grants =>
	mergeGrants(
		grantsOn('claim_requests', ['read', 'mutate.new', 'mutate.existing']),
		grantOn('claim_requests', 'delete', { authorize: unpinned }),
		grantsOn('allowances', ['read', 'mutate.new', 'mutate.existing']),
		grantOn('allowances', 'delete', { authorize: unpriced }),
		// The lines a run priced from a standing allowance: read beside the source, written by no one.
		grantsOn('allowance_entries', ['read']),
		grantsOn('loans', ['read', 'mutate.new', 'mutate.existing']),
		grantOn('loans', 'delete', { authorize: unsettledLoan }),
		// A repayment is written through its loan's schedule; the nested actions are judged here.
		grantsOn('loan_repayments', ['read', 'mutate.new', 'mutate.existing']),
		grantOn('loan_repayments', 'delete', { authorize: unpinned })
	);

export const payrollGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(grantsOn('payroll_runs', actions), grantsOn('payslips', actions));

/** Leave pickers need paid-period boundaries, without payroll inputs or results. */
export const leaveCalendarGrants = (ownCompany = false): Grants =>
	grantOn('payroll_runs', 'read', {
		fields: ['company_id', 'period', 'attendance_from', 'attendance_to'],
		...(ownCompany
			? {
					where: { payroll_run_company: { some: { employment_company: { some: OWN_EMPLOYMENT } } } }
				}
			: {})
	});

/**
 * What deleting a payroll run takes down with it.
 *
 * A caller's cascade descends as the caller's: the `cascade(...)` edges from a run
 * to its payslips are authorized against the deleting person's own delete grant on the collection,
 * exactly as a nested row they submitted would be. A slip's allowance entries go with it the same
 * way. The pins the run wrote are released with the slip, so nothing else needs a grant here: the
 * sources are only ever re-pinned by the run's transform, as the workspace.
 */
export const payrollRunCascadeGrants = (): Grants =>
	mergeGrants(
		grantOn('payslips', 'delete', { authorize: unpaidPayslip }),
		grantsOn('allowance_entries', ['delete'])
	);

/** Run payroll: create, and delete an unpaid run newest first. A run is never edited. */
export const payrollRunGrants = (): Grants =>
	mergeGrants(
		grantsOn('payroll_runs', ['mutate.new']),
		grantOn('payroll_runs', 'delete', { authorize: unpaidLatestRun })
	);

export const employeeReferenceGrants = (...actions: ReadonlyArray<'read'>): Grants =>
	mergeGrants(
		grantsOn('companies', actions),
		grantsOn('jurisdiction_holidays', actions),
		grantsOn('shift_definitions', actions),
		// The base an employee's own days are projected from; read in full, like the codes it names.
		grantsOn('shift_patterns', actions),
		grantsOn('claim_catalogue', actions),
		grantsOn('allowance_catalogue', actions),
		grantsOn('loan_catalogue', actions),
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

/**
 * A write that leaves the version a draft: the controller's whole authority over the root.
 *
 * There is no exception any more. The one that existed let `holiday_source` through under a seal,
 * because it was operational configuration rather than law — and once holidays moved to the entity
 * that column left this collection entirely, so keeping it in the allowlist would have been a
 * permanent hole in the seal for a column that no longer exists.
 */
const draftOnly = ({
	record,
	changes
}: {
	readonly record: { sealed_at?: unknown; voided_at?: unknown };
	readonly changes?: Readonly<Record<string, unknown>>;
}) =>
	Effect.succeed(
		(record.sealed_at == null && record.voided_at == null) ||
			(changes != null && Object.keys(changes).every((key) => ['id', 'row_version'].includes(key)))
	);

/**
 * The jurisdiction settings root, in two authorities.
 *
 * `'draft'` is the HR controller's: create and edit versions that stay drafts, delete drafts; a
 * write that would seal or void is refused outright, not held. `'seal'` is the HR Manager's and
 * Senior Management's: the same writes, plus sealing and voiding under approval. Neither is a way
 * around the seal: the root's transform freezes a sealed version and every child transform reads
 * the root as the workspace, so no policy can edit under a seal.
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
				grantOn('jurisdiction_settings', 'delete', { authorize: draftVersionOnly })
			);

/**
 * Settings authority over family catalogues and independent jurisdiction holiday inputs.
 * Catalogue transforms enforce their parent version's seal on every write and the delete grants
 * below on every delete; holiday calendars enforce publication and consumption seals.
 */
export const settingsCatalogueGrants = (
	...actions: ReadonlyArray<'read' | 'mutate.new' | 'mutate.existing' | 'delete'>
): Grants => {
	// Schemes and bands are read by every rank through `statutoryGrants`; only their writes are
	// this group's, so the two groups never grant one coordinate twice.
	const writes = actions.filter((action) => action !== 'read' && action !== 'delete');
	const others = actions.filter((action) => action !== 'delete');
	const deletes = actions.includes('delete');
	return mergeGrants(
		...(writes.length === 0 ? [] : [grantsOn('statutory_contributions', writes)]),
		grantsOn('leave_catalogue', others),
		grantsOn('claim_catalogue', others),
		grantsOn('allowance_catalogue', others),
		grantsOn('loan_catalogue', others),
		grantsOn('jurisdiction_holidays', others),
		...(deletes
			? [
					grantOn('statutory_contributions', 'delete', { authorize: unreferencedDraftScheme }),
					grantOn('leave_catalogue', 'delete', { authorize: draftSettingsRow }),
					grantOn('claim_catalogue', 'delete', { authorize: draftSettingsRow }),
					grantOn('allowance_catalogue', 'delete', { authorize: draftSettingsRow }),
					grantOn('loan_catalogue', 'delete', { authorize: draftSettingsRow }),
					grantOn('jurisdiction_holidays', 'delete', { authorize: uncapturedHoliday })
				]
			: [])
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

/** The plan: the roster code and its provenance. */
export const WORK_DAY_PLANNED_FIELDS = ['shift_definition_id'] as const;

/** The clock. Writing any of these is what review exists for. */
export const WORK_DAY_ATTENDANCE_FIELDS = ['worked_intervals'] as const;

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
	record.shift_definition_id == null && unpinned({ record });

/** A day a payroll run took into account is released by deleting that draft slip, never directly. */
const unpinnedWorkDay: WorkDayDeleteAuthorize = ({ record }) => unpinned({ record });

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
		grantOn('work_days', 'delete', { authorize: unpinnedWorkDay })
	);

const leaveApproval = {
	flow: () => approveBy(L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM),
	superceded_by: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM]
} as const;

const LEAVE_ENTRY_FIELDS = [
	'employment_id',
	'catalogue_id',
	'reference',
	'certificate_file',
	'from_date',
	'to_date',
	'half_day_start',
	'half_day_end',
	'days',
	'encash_days',
	'as_adjustment_entry',
	'reversal_of_id',
	'effective_on',
	'due_on',
	'destination_from',
	'destination_to',
	'available_from',
	'expires_on',
	'reason'
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

/** Whether the write's candidate record is the one request an ordinary rank may raise. */
function isLeaveTimeOffEvent(record: Record<string, unknown>): boolean {
	return leaveActivityOf(record as LeaveEntryActivity) === 'TIME_OFF';
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
			// allowance, an arrears settlement and an HR correction are authority the HR policies
			// hold and this one never adds — and now that each is its own collection, that is a
			// grant on a collection, which is what the access system is for. It used to be a
			// `Reflect.get(event, 'kind') === 'CLAIM'` reach into a jsonb discriminator, because the
			// families shared one table and the grant had no other way to name one of them.
			authorize: ({ record }, api) => employmentBelongsToRequestor(record.employment_id, api),
			approval: claimApproval
		})
	);
