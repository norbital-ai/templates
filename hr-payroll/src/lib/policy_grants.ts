import type { Policy } from '../access/policies/$types.js';

/**
 * ============================================================================
 * THE POLICY LADDER, THE TWO PAYROLL AUTHORITIES, AND THE TWO LOCKS
 * ============================================================================
 *
 * This file composes every grant the six policies in `src/access/policies` are built from. It is the
 * design document for all of them because it is the only place that sees them together.
 *
 * ## 1. The ladder
 *
 * Four ordinary levels, increasing, and two special payroll authorities that sit beside the ladder
 * rather than on it:
 *
 * ```
 *   employee → supervisor → manager → senior_management        (rank)
 *                                          ▲
 *                 hr_controller → hr_manager                   (payroll authority)
 * ```
 *
 * A policy is selected by its filename key, case-folded, and by nothing else. The compiler derives
 * `PolicyName` from the six `src/access/policies/+<name>.ts` files; `src/access/+teams.ts` consumes
 * that union for people and an envoy declaration consumes it for a static identity. There is no
 * authored `name` field or display spelling to drift from the key.
 *
 * *Which* teams hold which of those six names is `src/access/+teams.ts` and only that file. The two
 * files are the two halves of authority here: that one says who holds a policy, this one says what
 * holding it grants.
 *
 * The owner wrote the top rank as "senior management". It is `senior_management` here because that
 * is the file it lives in; the prose spelling belongs in the i18n catalogues, which is where a
 * reader is shown one and where getting it wrong costs a label rather than a grant.
 *
 * ### Do higher levels inherit lower grants? Yes — and inheritance is *materialized*, not derived.
 *
 * Chosen, because the runtime leaves no other option and the option it does leave is safe:
 *
 *   - There is no `extends` in the authoring surface and no notion of rank in the runtime. A
 *     subject whose team declares only `manager` matches only the `manager` policy, so anything
 *     not written into that file is not granted to a manager. Inheritance therefore has to be
 *     spelled out at authoring time or it does not exist at all. Each policy below composes the
 *     same builder functions the rank beneath it composes, plus its own.
 *
 *   - Composition is safe in this direction because `rowPredicate` **unions** the matching grants:
 *     the `where` clauses of every matching grant are OR-ed, and one unconditional matching grant
 *     collapses the whole predicate to `true`. So a higher rank can only ever be handed *more*.
 *
 *   - The corollary is the trap, and it is why the adjustment predicate below is written the way it
 *     is: a narrowing can never be applied at the top by subtraction. `NOT_AN_ADJUSTMENT` has to be
 *     present on **every** policy that must not see adjustments, because a single unconditional
 *     `component_entries` read anywhere in a policy the subject matches erases it.
 *
 *   - The two special authorities are orthogonal to rank, so a person may hold `manager` *and*
 *     `hr_controller`. A person belongs to one team, so that combination is not an emergent union
 *     of two memberships — it is a team that declares both names, `Manager (HR Controller)` in
 *     `src/access/+teams.ts`. The union of their grants does the right thing without either policy
 *     knowing about the other.
 *
 * ## 2. Who may do what to `payroll_runs`
 *
 * | policy              | read | create             | update / re-run | delete           |
 * | ------------------- | ---- | ------------------ | --------------- | ---------------- |
 * | employee            | –    | –                  | –               | –                |
 * | supervisor          | –    | –                  | –               | –                |
 * | manager             | –    | –                  | –               | –                |
 * | `hr_controller`     | yes  | **held for review** | –              | –                |
 * | `hr_manager`        | yes  | direct             | yes             | yes, DRAFT only  |
 * | `senior_management` | yes  | direct             | yes             | yes, DRAFT only  |
 *
 * Viewing payroll is enumerated authority, not a consequence of rank: the owner named exactly three
 * policies that may view it. A supervisor and a manager therefore read people, time and leave — the
 * things they act on — and read no payroll at all. They are still given the `hr_controller` app
 * group so their review screens are reachable; the payroll screen inside it renders empty for them,
 * which is the correct outcome and the point of the whole exercise: **navigation is not authority,
 * the grant is.**
 *
 * `hr_controller` gets a `payroll_runs` create grant *carrying an approval*, which is how "may not
 * create it" is expressed: the row is written and immediately held under `norbital_approval_id`,
 * and it is `hr_manager` or `senior_management` who decide whether it stands. See
 * `payrollRunApprovalFromController` below.
 *
 * ## 3. Two locks, and why they are not the same column
 *
 * **Approval lock — `norbital_approval_id`.** Platform-owned. Bolt's runtime stamps it while an
 * approval request is open and clears it when the request settles. It answers exactly one question:
 * *is this write still waiting for a person to decide?* Nothing in this workspace may write it.
 *
 * **Settlement lock — a row in `payslip_sources`.** Workspace-owned. One row per
 * (payslip, source collection, source record) written by the engine's PERSIST step, saying *this
 * payslip consumed this record*. It is released when — and only when — the payslip that holds it is
 * deleted, which the database is declared to do itself: the cascade on `payslips.payroll_run_id`
 * drops a run's payslips, and the cascade on `payslip_sources.payslip_id` drops their claims with
 * them. A run that reached `PAID` cannot be deleted, so its locks are permanent and corrections go
 * through adjustment entries.
 *
 * That release is performed by the database, in the same statement that deletes the run — a
 * hand-written release would have to page through the claims and delete them one at a time, and the
 * reachable delete (`api.db.<collection>.delete(identifiers)`) takes `identifiers[0]` and drops the
 * rest — a loop over it would release part of a run's claims and report success, which is worse
 * than a release that never ran. See `src/collections/payslip_sources/+model.ts`.
 *
 * They are different questions and they must not share storage:
 *
 *   - `gather.ts` filters every source query on `norbital_approval_id IS NULL` and calls that
 *     *live*. **That is today's conflation.** The same column is being read as liveness ("payroll
 *     may consume this") and, by `sourceLock`, as a write lock ("nobody may touch this"). Storing
 *     settlement there would mean the second build of a period could no longer see the rows the
 *     first build consumed — the run would silently recompute itself down to nothing — and an
 *     approval decision on an unrelated edit would quietly release a settled payroll record.
 *
 *   - Settlement has to name *which* run holds the claim, so that deleting run A releases A's rows
 *     and leaves B's alone. `norbital_approval_id` names an approval request, not a run.
 *
 * Before this change there was no stored settlement at all: `src/lib/scheduling/lock.ts` inferred it
 * from arithmetic over `payroll_runs.attendance_from/attendance_to` where `lifecycle = 'PAID'`. That
 * inference was wrong in both directions — a DRAFT run that had already written payslips citing a
 * record left that record editable underneath it, and a record merely *dated* inside a paid window
 * was frozen even when no payslip had ever consumed it. The window arithmetic is kept for the
 * calendar stripes, which is a question about days; the lock is now a question about records.
 *
 * ## 4. Adjustments
 *
 * An adjustment is a `component_entries` row whose `origin.kind` is `MANUAL_ADJUSTMENT` — a
 * discriminated kind on the existing collection, not a new one. See `NOT_AN_ADJUSTMENT`.
 *
 * ============================================================================
 *
 * This lives in `src/lib` rather than beside the policies because `src/access/policies` admits only
 * `+<name>.ts` — anything else there is a `POLICY_NAME_INVALID` diagnostic, not a module.
 *
 * The grouping is kept, not flattened. Core's seed used to generate ~140 grants from four collection
 * lists crossed with action lists, and the lists are the statement: a company writes its own
 * configuration and only ever reads the law. Expanded to literal grants that distinction is
 * unrecoverable — you would have to diff two long lists to notice that `contribution_rates` has no
 * `update` while `pay_components` does.
 *
 * Each group is a **function over actions** rather than an array of names, and that shape is forced
 * rather than chosen. `PolicyGrant` is a distributed union that pairs each collection with its own
 * row type, so `{ collection: 'a' | 'b', action }` is assignable to neither member: TypeScript does
 * not push a union-typed discriminant through a union target. Mapping an array of names therefore
 * cannot typecheck without a cast, and a cast here would be exactly the wrong thing — it is the
 * pairing that stops a `where` from naming another collection's column. `grantsOn` takes **one**
 * collection as a literal generic, so every name below is still checked at its call site.
 */

type Grant = Policy['grants'][number];
type Action = Grant['action'];
type WhereOn<C extends Grant['collection']> = Extract<Grant, { readonly collection: C }>['where'];

/** Unconditional grants for one collection. The generic keeps `collection` a literal, so it checks. */
export function grantsOn<const C extends Grant['collection']>(
	collection: C,
	actions: readonly Action[]
) {
	return actions.map((action) => ({ collection, action }));
}

/**
 * Row-scoped grants for one collection.
 *
 * The same literal generic as `grantsOn`, for the same reason and with one more: `WhereOn<C>` is
 * that collection's own row type, so a predicate naming a column of a *different* collection is a
 * compile error rather than SQL that fails at request time.
 */
export function grantsOnWhere<const C extends Grant['collection']>(
	collection: C,
	actions: readonly Action[],
	where: WhereOn<C>
) {
	return actions.map((action) => ({ collection, action, where }));
}

/**
 * A component entry that is not a correction.
 *
 * The adjustment path is the `MANUAL_ADJUSTMENT` arm of `component_entries.origin`, and this is the
 * predicate that keeps those rows out of an ordinary person's reads. Chosen as a discriminated kind
 * on an existing collection rather than a new `adjustments` collection because:
 *
 *   - `component_entries` is documented as "the only door money enters payroll through". A
 *     correction is money. A second collection would be a second door, and MEASURE, ACCUMULATE,
 *     CONTRIBUTE and SETTLE would each need a parallel path to walk it — four places where an
 *     adjustment could be forgotten by a statutory rule that already handles entries correctly.
 *
 *   - The origin union already carries `REVERSAL` and `ARREARS` beside `MANUAL_ADJUSTMENT`.
 *     Correction-shaped provenance is already how this collection says "this money exists because
 *     something earlier was wrong"; an adjustment is the manual member of that family.
 *
 *   - `usage_mode` generates to `SINGLE_USE` for anything that is not `RECURRING`, so the existing
 *     unique index on `payslip_lines (component_entry_id) WHERE component_entry_usage =
 *     'SINGLE_USE'` already guarantees an adjustment is consumed by exactly one payslip. A new
 *     collection would start with no such guarantee.
 *
 * Written as `$sql` and never as `RAW`. `RAW` is a function, a grant is stored as jsonb, and a
 * dropped function leaves `conditions: {}` — which the guard reads as *unconditional*. On a read of
 * `component_entries` that would hand every employee every correction in the workspace.
 *
 * `IS DISTINCT FROM` rather than `<>`: `origin` is `not null`, but the projection is a jsonb text
 * extraction and a row whose payload lost its `kind` would compare NULL and vanish from an
 * ordinary person's list without anybody being told. Distinctness keeps it visible.
 */
export const NOT_AN_ADJUSTMENT = {
	$sql: `"origin"->>'kind' IS DISTINCT FROM 'MANUAL_ADJUSTMENT'`
} as const;

/**
 * Configuration a company reads and writes.
 *
 * `roster_entries` sits here rather than with people because a roster is scheduling configuration
 * that HR edits in bulk, even though an employee reads only their own rows out of it. `rosters`
 * joins it for the same reason. The work pattern itself lives in employment terms, not a separate
 * reference collection.
 */
export const referenceGrants = (...actions: Action[]): readonly Grant[] => [
	...grantsOn('companies', actions),
	...grantsOn('company_holidays', actions),
	...grantsOn('shift_definitions', actions),
	...grantsOn('rosters', actions),
	...grantsOn('roster_entries', actions),
	...grantsOn('pay_components', actions),
	...grantsOn('leave_types', actions)
];

/**
 * Jurisdiction and global rows: readable by everyone who needs to explain a number, writable by none.
 *
 * Every caller passes `'read'` and that is the point — the law is stated once by product, and a
 * company may read across that boundary but never write across it.
 */
export const statutoryGrants = (...actions: Action[]): readonly Grant[] => [
	...grantsOn('jurisdictions', actions),
	...grantsOn('statutory_contributions', actions),
	...grantsOn('contribution_rates', actions)
];

/**
 * People records, excluding `time_entries` and `component_entries`.
 *
 * `time_entries` is split out because no role writes it directly — every create and update is gated
 * behind the direct manager. Leaving it in the group and subtracting it at each call site is how the
 * seed did it, and it made the exception something you had to notice inside a `.filter()`.
 *
 * `component_entries` is split out now for exactly that reason. It is the collection the adjustment
 * rule lives on, and the rule is a *narrowing* — which the union of grants cannot express by
 * subtraction. Every policy therefore has to state its own `component_entries` grant, in full, where
 * a reader can see whether it carries `NOT_AN_ADJUSTMENT`. Folded back into this group, "senior
 * management sees corrections and a manager does not" would be a difference between two call sites
 * that look identical.
 */
export const peopleGrants = (...actions: Action[]): readonly Grant[] => [
	...grantsOn('employees', actions),
	...grantsOn('employments', actions),
	...grantsOn('employment_terms', actions),
	...grantsOn('employment_statutory_facts', actions),
	...grantsOn('repayment_agreements', actions)
];

/**
 * Payroll output. Read-only as a group; `payroll_runs` gets its writes stated separately.
 *
 * `payslip_sources` is here rather than in a group of its own because it *is* payroll output:
 * one row per source record a payslip consumed. Anyone who may read a payslip may read what that
 * payslip consumed.
 */
export const payrollGrants = (...actions: Action[]): readonly Grant[] => [
	...grantsOn('payroll_runs', actions),
	...grantsOn('payslips', actions),
	...grantsOn('payslip_lines', actions),
	...grantsOn('payslip_sources', actions)
];

/**
 * What re-running a draft costs in permissions.
 *
 * `clearRunResults` wipes the run's previous payslips before writing new ones, and it does that
 * through `api.db.delete`, which is **not** an elevated write: it authorizes against the requesting
 * subject exactly as a person's own delete would. So a role that may recalculate a draft must hold
 * delete on the two collections a run's payslips own, or the rebuild fails on the clear and the run
 * keeps last build's figures while reporting success. The source rows go with the payslips, by the
 * database's own cascade — no `payslip_sources` delete grant exists, because nothing ever deletes
 * one by hand.
 *
 * This is deliberately *not* given to `hr_controller`. A controller may raise a run and never
 * re-runs one, and a fresh run has nothing to clear — `clearRunResults` returns before it deletes
 * anything when the run has no payslips yet.
 */
export const payrollRebuildGrants = (): readonly Grant[] => [
	...grantsOn('payslips', ['delete']),
	...grantsOn('payslip_lines', ['delete'])
];

/**
 * The settlement ledger, readable by everybody.
 *
 * Every ordinary person needs this. The refusal that tells an employee their time entry is settled
 * is computed by a hook running **under that employee's own subject**, and a hook read goes through
 * the same access boundary a person's read does. Without this grant the employee's edit would fail
 * with a bare access denial naming a collection they have never heard of, instead of the sentence
 * that tells them to ask HR for an adjustment.
 *
 * Unconditional, and safely so: a source row carries a payslip id, a period, a collection name and a
 * record id. No money, no name, no rate. It discloses that a record was consumed by a payroll run,
 * which is precisely what the person is about to be told.
 */
export const settlementLedgerGrants = (): readonly Grant[] => [
	...grantsOn('payslip_sources', ['read'])
];

/** What an employee may read to understand their own numbers: company-wide facts, not personal rows. */
export const employeeReferenceGrants = (...actions: Action[]): readonly Grant[] => [
	...grantsOn('companies', actions),
	...grantsOn('company_holidays', actions),
	...grantsOn('shift_definitions', actions),
	// Employment terms carry the schedule. The roster's published stamp still tells the employee
	// whether the month is draft or settled.
	...grantsOn('rosters', actions),
	...grantsOn('pay_components', actions),
	...grantsOn('leave_types', actions)
];

/**
 * Teams the approval steps route to, named by `team.name`.
 *
 * These used to be `team.norbital_id` values carried over from Core's seed verbatim — private
 * identifiers from one database, sitting in a public template, checked by nothing and unsatisfiable
 * anywhere that seed had not run. A team is a runtime row, so its id cannot be declared; its name can.
 * `bolt_team.name` is unique and compared folded wherever it is compared, so the name is a stable
 * key into whichever tenant this release is deployed into.
 *
 * Nothing checks these names at build or deploy time, and nothing can: the rows are operator data.
 * A name here with no `bolt_team` row behind it is not a refusal — it is a step nobody is eligible
 * to decide, which is the same outcome as a team that exists and is empty. That is a membership
 * problem, fixed by creating the team or putting somebody in it, and it is why these are the same
 * strings as the keys in `src/access/+teams.ts` and as the `bolt_team` rows this workspace is seeded
 * with.
 *
 * The config and step **ids** are still carried verbatim, and that is a different thing: an in-flight
 * `approval_request` resolves against them, so a fresh one strands every request already raised.
 */
/**
 * A step lists **every** team that may decide it, because a person belongs to exactly one.
 *
 * That is the rule change underneath these constants. Membership used to be an array — somebody
 * could be in `HR Manager` and `L1 Manager` and `HQ Payroll HR` at once, so a step naming one team
 * was reachable by anyone who happened to also hold it. It is one team now
 * (`bolt_auth_user.team_id`), so a step naming a single team is decidable only by that exact team,
 * and every rung above it is locked out of a decision it obviously ought to be able to make.
 *
 * Approval checks each candidate against the person's own team (`subject.teamPath[0]`), so listing
 * several teams makes any of them sufficient — which is what seniority means here. The
 * comparison is case-insensitive on both sides, the same rule the policy side matches names by, so
 * a step naming `HR manager` and a team named `HR Manager` are the same team and only a genuinely
 * different string strands the step. Two *steps* would mean two signatures; one step
 * with several approvers means one signature from any of them. `payrollRunApprovalFromController`
 * already worked this way and says so at length; the other three now match it.
 */
const HQ_PAYROLL_HR_TEAM = 'HQ Payroll HR';
const HR_MANAGER_TEAM = 'HR Manager';
const L1_MANAGER_TEAM = 'L1 Manager';
/**
 * The escalation a controller's payroll create routes to.
 *
 * A new name, so it needs a team behind it in the tenant, and nobody is exempt from that —
 * `dispatch.identity.admitFounder` places the first administrator in **no team**. It used to derive
 * a teams array by walking every `approvers` entry across every grant, precisely so a fresh
 * workspace's founder could decide this step; that guess is gone, because `admin` short-circuits
 * `AccessControl.decide` and does *not* bypass an approval. So immediately after provisioning the
 * founder administers everything and can decide nothing that is gated, until somebody is put in the
 * team. That is the intended answer, and it is visible rather than silently pre-empted: an approval
 * nobody is eligible to decide is an approval that waits forever, and that is a membership problem,
 * not a policy problem.
 */
const SENIOR_MANAGEMENT_TEAM = 'Senior Management';

/** The approval shape, taken from the grant that holds it so there is nothing to keep in step. */
type Approval = NonNullable<Grant['approval']>;

/**
 * **There are no ids here any more, and their absence is the point.**
 *
 * Every one of these used to take a `configId` and derive a step id from it by replacing the last
 * character with `9` — a scheme that collided: `…000004`, `…000006`, `…000007` and `…000008` all
 * derived `…000009`, four flows whose steps were indistinguishable. The workaround was to make each
 * *new* config id differ in the third digit from the end, which is a rule nobody could have inferred
 * and everybody had to remember.
 *
 * A request's identity now derives from `(policy, collection, action, step key)`, computed by
 * `describePolicy`. Two grants are never the same grant, so the id is unique by construction; it is
 * stable across releases, because nothing about it depends on ordering; and there is nothing left
 * for a copy-paste to duplicate. The whole collision class is gone with the ids.
 *
 * `key` is what the id derives from, so reordering the steps in a grant cannot silently rebind an
 * approval that is already in flight. Order carries no meaning; the key does.
 *
 * Each is a `const` rather than a factory, because several grants want the same steps and sharing
 * one is ordinary TypeScript.
 */

/** Attendance becomes a payroll source, so the direct manager sees it before it can become one. */
export const timeEntryApproval = {
	steps: [
		{
			key: 'direct_manager_review',
			approvers: [L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM],
			description:
				'The employee direct manager reviews attendance before it can become a payroll source.'
		}
	]
} as const satisfies Approval;

/** Leave goes to the requester's direct manager. */
export const leaveApproval = {
	steps: [
		{
			key: 'direct_manager_review',
			approvers: [L1_MANAGER_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM],
			description: 'The employee direct manager reviews the leave request.'
		}
	]
} as const satisfies Approval;

/** A claim is money, so it skips the line manager and goes straight to HQ Payroll HR. */
export const claimApproval = {
	steps: [
		{
			key: 'hq_payroll_hr_review',
			approvers: [HQ_PAYROLL_HR_TEAM, HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM],
			description: 'HQ Payroll HR performs the final claim review.'
		}
	]
} as const satisfies Approval;

/** Opening a run commits every payslip under it, so an HR Manager reconciles it first. */
export const payrollRunApproval = {
	steps: [
		{
			key: 'hr_manager_review',
			approvers: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM],
			description: 'An HR Manager reconciles the run before payslips become final.'
		}
	]
} as const satisfies Approval;

/**
 * The controller's route to a payroll run: raise it, and hand the decision upwards.
 *
 * This is what "an `hr_controller` MAY VIEW payroll and MAY NOT CREATE it" compiles to. A gated
 * create is not a refused create — `Collections.create` runs the hooks, writes the row, and *then*
 * stamps `norbital_approval_id`, so the controller gets a run to look at and nobody gets a payroll
 * that has not been agreed to. The engine still builds it in `create.after`, and the figures stay
 * held behind the lock until the step is decided.
 *
 * One step with two approver teams, not two steps. `approvals.decide` tests
 * `step.approvers.some((team) => team folded === subject's own team folded)` — a person has one
 * team, and any listed team matches it — so listing both makes either sufficient, which is what
 * "approval from `hr_manager` **or** senior management" says. Two steps would mean *both*, and would
 * leave every controller-raised run waiting on a second signature the owner never asked for.
 *
 * It is a separate const from `payrollRunApproval` even though the approver lists match, because the
 * two are different flows on different grants and the derived id keeps them apart automatically.
 */
export const payrollRunApprovalFromController = {
	steps: [
		{
			key: 'hr_manager_or_senior_review',
			approvers: [HR_MANAGER_TEAM, SENIOR_MANAGEMENT_TEAM],
			description:
				'An HR Controller may prepare a payroll run but may not commit one. An HR Manager or ' +
				'Senior Management decides whether it stands.'
		}
	]
} as const satisfies Approval;
