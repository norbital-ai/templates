import {
	captureLedgerGrants,
	eventLeaveAccountGrant,
	grantsOn,
	grantOn,
	leaveApproval,
	manualLeaveAdjustmentGrant,
	leavePlanControllerGrants,
	mergeGrants,
	payrollGrants,
	payrollRebuildGrants,
	payrollRunApprovalFromController,
	peopleGrants,
	referenceGrants,
	statutoryGrants,
	statutoryProfileGrants,
	workDayWriteGrants
} from '../../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Special role 1 of 2. HR administration, and the one role that may look at payroll without being
 * able to commit it.
 *
 * The owner's words: an `hr_controller` **may view** payroll but may not land a new run directly;
 * a new-row mutation raised by a controller requires approval from `hr_manager` or senior
 * management. Those are three separate statements about three different grants and they are
 * written out below rather than summarised:
 *
 *   - `payrollGrants('read')` — the view. All four payroll collections.
 *   - `payroll_runs.mutate.new` **carrying an approval** — Bolt writes the row and immediately
 *     stamps `approval_id`, so the controller gets a run to inspect and nobody gets a payroll that
 *     has not been agreed to.
 *   - no `payroll_runs.mutate.existing`, no `payroll_runs.delete` — a controller does not re-run a
 *     payroll and does not erase one.
 *   - `payrollRebuildGrants()` — the engine's `create.before` hook writes payslips, adjustments and
 *     junctions as the **requesting subject**, not elevated. Without these grants a held create
 *     refuses on its own output. This is not re-run authority: it does not add `mutate.existing` or
 *     `delete` on `payroll_runs`, and a controller never calls `clearRunResults`.
 *
 * Kept generated, because the groups are what the policy actually says. `referenceGrants` with four
 * actions beside `statutoryGrants` with one is a rule you can read — a company owns its configuration
 * and only reads the law — and it vanishes into eighty indistinguishable lines once flattened. The
 * exceptions are written out below the generated blocks, which is where the interesting part of any
 * permission set lives. See `src/lib/policy_grants.ts` for why the groups are functions.
 *
 * Each gated grant returns one fluent approval flow. Runtime derives durable stage identities from
 * the policy, collection, grant coordinate and stage position; authors name only approver teams.
 *
 * `apps: ['hr_controller']` names the app *group*. Nine apps sit under it and
 * `appAccessAllowed` matches a group prefix, so this remains one stable grant as pages are added.
 */
export default {
	description:
		'HR administration across people, scheduling, requests, loans and adjustments, with payroll visible but not committable.',
	/**
	 * Self-service first, because it is the one app nobody's rank gates.
	 *
	 * `hr_employee` shows a person their own employment: their payslips, their leave balance, their
	 * roster. Every rung of this ladder is somebody's employee, so every rung has one — and until now
	 * only `employee` listed it, which meant an HR manager could run the company's payroll and not
	 * look at their own. It is listed on every policy rather than inherited because there is nothing
	 * to inherit through: `visibleApps` reads the `apps` array of the policies a subject's team
	 * confers, and a policy that does not name the app does not offer it.
	 *
	 * The row scope is unchanged and does the actual work: the app's queries use `subject.email`
	 * -scoped, so naming it here shows a person their own record and nobody else's.
	 */
	/**
	 * The HR group, which is not for everybody on the ladder.
	 *
	 * `hr_controller` is the app *group*; nine apps sit under it and `visibleApps` matches a child
	 * by its `<group>/` prefix, so naming the group offers all nine. The owner's spec is that HR
	 * apps are for L1 management, the HR manager and the HR controller — `manager` is the L1 rung
	 * (`policy_grants.ts` names its approver team `L1 Manager`), so `supervisor` and
	 * `senior_management` have self-service and no HR group. That is a narrowing: both keep every
	 * collection grant this file lists, and an approval flow routed to `Senior Management` is
	 * decided from the notification and the request surface rather than from the HR app.
	 */
	capabilities: { apps: ['hr_employee', 'hr_controller'] },

	grants: mergeGrants(
		referenceGrants('read', 'mutate.new', 'mutate.existing', 'delete'),
		leavePlanControllerGrants(),
		statutoryGrants('read'),
		statutoryProfileGrants(),
		// Research receipts are append-only worker evidence. Controllers may inspect but not alter them.
		peopleGrants('read'),
		peopleGrants('mutate.new', 'mutate.existing', 'delete'),
		grantsOn('work_days', ['read']),

		/**
		 * The entry path, unconditional and stated here rather than folded into `peopleGrants`.
		 *
		 * This is the whole of "only HR-policy holders may add corrections": no policy on the ordinary
		 * ladder has an unconditional `component_entries.mutate.new`. Employee, supervisor and
		 * manager share one grant pinned to their own employment and a `CLAIM` event; it cannot
		 * add the `MANUAL_ADJUSTMENT` variant. There is nothing to subtract, because correction
		 * authority was never added below this policy.
		 *
		 * Unconditional on read, too, which is the other half of the rule — a correction-hiding
		 * predicate is absent here on purpose, so a controller sees the corrections everyone below
		 * them cannot.
		 *
		 * No approval flow. The owner gated exactly one thing, the payroll run, and a gate nobody asked
		 * for would leave every correction to a settled payslip waiting on a signature — which is the
		 * situation corrections exist to get out of.
		 */
		grantsOn('component_entries', ['read', 'mutate.new', 'mutate.existing', 'delete']),
		grantsOn('loans', ['read', 'mutate.new', 'mutate.existing', 'delete']),
		grantsOn('loan_repayments', ['read', 'mutate.new', 'mutate.existing', 'delete']),

		// Both sides of the person-day: publish the schedule, and record what happened against it.
		// The approval resolver decides per write — a roster edit is not reviewed, and an attendance
		// write is, which is exactly what the two collections said before they became one. Deleting
		// is unreviewed and always was: removing a day withdraws a claim on payroll rather than
		// making one, and routing a withdrawal through the manager who would have to notice it only
		// leaves the bad row sitting in the run.
		workDayWriteGrants(),

		grantsOn('leave_requests', ['read', 'mutate.existing', 'delete']),
		grantOn('leave_requests', 'mutate.new', { approval: leaveApproval }),
		eventLeaveAccountGrant(true),
		manualLeaveAdjustmentGrant(true),

		payrollGrants('read'),
		payrollRebuildGrants(),
		// The engine reads the capture junctions under the requesting subject while it gathers: which
		// one-off entries an earlier run already took, and what a prior payslip captured. Without
		// this read a company with either refuses the run with a bare policy denial.
		captureLedgerGrants(),
		grantOn('payroll_runs', 'mutate.new', { approval: payrollRunApprovalFromController })
	),
	/**
	 * What a holder of this policy may spend.
	 *
	 * Declared here rather than in a workspace-wide file, because a rate limit is only meaningful in
	 * terms of who is spending it: `collections.*` is authenticated and cheap, `agents.turn` is
	 * authenticated and costs money at a model provider. Two classes of person holding two policies
	 * can now be given two budgets for the same command, which one file for everybody could not say.
	 */
	limits: {
		'collections.*': { window: '1 min', limit: 600, key: 'subject' },
		'agents.turn': { window: '1 hour', limit: 100, key: 'subject' }
	}
} satisfies Policy;
