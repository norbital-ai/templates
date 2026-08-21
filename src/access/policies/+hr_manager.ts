import {
	grantsOn,
	leaveApproval,
	payrollGrants,
	payrollRebuildGrants,
	peopleGrants,
	referenceGrants,
	statutoryGrants,
	timeEntryApproval
} from '../../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Special role 2 of 2. Everything an `hr_controller` may do, and the three payroll authorities a
 * controller may not hold: create without review, re-run, and delete.
 *
 * The owner's words: an `hr_manager` — and senior management — may **view, create and run** payroll.
 * Those map to four grants, and the fourth is the one that is easy to miss:
 *
 *   - `payrollGrants('read')` — view.
 *   - `payroll_runs: create`, with **no** approval — create. This is the difference from
 *     `hr_controller` and it is the entire difference: same collection, same action, no gate. It is
 *     also the other end of the controller's escalation, since it is holders of this role who sit in
 *     the `HR Manager` team the controller's step routes to.
 *   - `payroll_runs: update` — run. A same-state DRAFT update is this workspace's recalculate.
 *   - `payrollRebuildGrants()` — run, continued. `clearRunResults` wipes the previous results before
 *     writing new ones and does it through `api.db.delete`, which authorizes against the requesting
 *     subject rather than running elevated. Without these three deletes a recalculation fails on the
 *     clear, and the run would keep the previous build's figures while reporting a fresh one.
 *   - `payroll_runs: delete` — the release path for the settlement lock. Deleting a run cascades to
 *     its payslips and their `payslip_sources` rows, which is what unlocks the time entries,
 *     component entries and leave requests that run consumed. `payroll_runs/+hooks.ts` refuses the
 *     delete outright once `lifecycle = 'PAID'`, so this grant can only ever release a draft's claims.
 *
 * The generated groups and shared approval declarations carry over from `+hr_controller.ts`.
 * Derived approval identity includes this policy key, so the same steps reached through another
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
	 * collection grant this file lists, and an approval step routed to `Senior Management` is
	 * decided from the notification and the request surface rather than from the HR app.
	 */
	capabilities: { apps: ['hr_employee', 'hr_controller'] },

	grants: [
		...referenceGrants('read', 'create', 'update', 'delete'),
		...statutoryGrants('read'),
		...peopleGrants('read'),
		...peopleGrants('create', 'update', 'delete'),
		...grantsOn('time_entries', ['read']),

		// The adjustment path. Unconditional on both read and create — see `+hr_controller.ts`.
		...grantsOn('component_entries', ['read', 'create', 'update', 'delete']),

		{
			collection: 'time_entries',
			action: 'create',
			approval: timeEntryApproval
		},
		{
			collection: 'time_entries',
			action: 'update',
			approval: timeEntryApproval
		},
		{ collection: 'time_entries', action: 'delete' },

		...grantsOn('leave_requests', ['read', 'update', 'delete']),
		{
			collection: 'leave_requests',
			action: 'create',
			approval: leaveApproval
		},

		...payrollGrants('read'),
		...payrollRebuildGrants(),
		...grantsOn('payroll_runs', ['create', 'update', 'delete'])
	],
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
