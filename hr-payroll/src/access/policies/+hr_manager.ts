import {
	grantsOn,
	grantOn,
	leaveApproval,
	mergeGrants,
	payrollGrants,
	payrollRebuildGrants,
	peopleGrants,
	referenceGrants,
	statutoryGrants,
	statutoryProfileGrants,
	workDayWriteGrants
} from '../../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Special role 2 of 2. Everything an `hr_controller` may do, and the three payroll authorities a
 * controller may not hold: `mutate.new` without review, `mutate.existing` for re-runs, and delete.
 *
 * The owner's words: an `hr_manager` — and senior management — may **view, create and run** payroll.
 * Those map to four grants, and the fourth is the one that is easy to miss:
 *
 *   - `payrollGrants('read')` — view.
 *   - `payroll_runs.mutate.new`, with **no** approval. This is the difference from `hr_controller`:
 *     same collection and grant coordinate, no gate. It is also the other end of the controller's
 *     escalation, since it is holders of this role who sit in the `HR Manager` team the
 *     controller's step routes to.
 *   - `payroll_runs.mutate.existing` — run. A same-state DRAFT mutation is this workspace's
 *     recalculate.
 *   - `payrollRebuildGrants()` — run, continued. `clearRunResults` wipes the previous results before
 *     writing new ones and does it through `api.db.delete`, which authorizes against the requesting
 *     subject rather than running elevated. Without these three deletes a recalculation fails on the
 *     clear, and the run would keep the previous build's figures while reporting a fresh one.
 *   - `payroll_runs: delete` — the release path for the settlement lock. Deleting a run cascades to
 *     its payslips and their `payslip_adjustments` rows, which is what unlocks the work days,
 *     component entries and leave requests that run consumed. `payroll_runs/+hooks.ts` refuses the
 *     delete outright once `lifecycle = 'PAID'`, so this grant can only ever release a draft's claims.
 *
 * The generated groups and shared approval declarations carry over from `+hr_controller.ts`.
 * Derived approval identity includes this policy key, so the same flow reached through another
 * policy remain distinct in history without hand-authored ids.
 */
export default {
	description:
		'HR management: everything HR administration covers, plus creating, running and deleting payroll runs.',
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
	 * The row scope is unchanged and does the actual work: the app's queries are `${requestor.email}`
	 * -scoped, so naming it here shows a person their own record and nobody else's.
	 */
	/**
	 * The HR group, which is not for everybody on the ladder.
	 *
	 * `hr_controller` is the app *group*; eight apps sit under it and `visibleApps` matches a child
	 * by its `<group>/` prefix, so naming the group offers all eight. The owner's spec is that HR
	 * apps are for L1 management, the HR manager and the HR controller — `manager` is the L1 rung
	 * (`policy_grants.ts` names its approver team `L1 Manager`), so `supervisor` and
	 * `senior_management` have self-service and no HR group. That is a narrowing: both keep every
	 * collection grant this file lists, and an approval flow routed to `Senior Management` is
	 * decided from the notification and the request surface rather than from the HR app.
	 */
	capabilities: { apps: ['hr_employee', 'hr_controller'] },

	grants: mergeGrants(
		referenceGrants('read', 'mutate.new', 'mutate.existing', 'delete'),
		statutoryGrants('read'),
		statutoryProfileGrants(),
		grantsOn('statutory_profile_drift_logs', ['read']),
		peopleGrants('read'),
		peopleGrants('mutate.new', 'mutate.existing', 'delete'),
		grantsOn('work_days', ['read']),

		// The adjustment path. Unconditional on both read and `mutate.new` — see `+hr_controller.ts`.
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

		payrollGrants('read'),
		payrollRebuildGrants(),
		grantsOn('payroll_runs', ['mutate.new', 'mutate.existing', 'delete'])
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
