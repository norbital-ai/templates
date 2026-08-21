import {
	NOT_AN_ADJUSTMENT,
	grantsOn,
	grantsOnWhere,
	leaveApproval,
	peopleGrants,
	referenceGrants,
	settlementLedgerGrants,
	statutoryGrants,
	timeEntryApproval
} from '../../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Rank 3 of 4. A supervisor, plus the authority to withdraw rather than only to raise.
 *
 * The whole of the supervisor's set is composed again here rather than inherited, because there is
 * no policy-to-policy inheritance: a subject holding only `manager` matches only this file and is
 * granted only what this file lists.
 * See the ladder in `src/lib/policy_grants.ts`.
 *
 * What rank 3 adds to rank 2 is deletion — of a time entry and of a leave request. The asymmetry is
 * the seed's and it is worth restating: removing an entry *withdraws* a claim on payroll rather than
 * making one, so it carries no approval step. Routing a withdrawal through the manager who would
 * have to notice it only leaves the bad row sitting in the run.
 *
 * Still no payroll. A manager reads people, time and leave; `payroll_runs`, `payslips` and
 * `payslip_lines` are enumerated authority that begins at `hr_controller` and `senior_management`.
 * The previous `Management` policy in this template granted a manager read, create, update and
 * delete on `payroll_runs`; under the owner's ladder that was three authorities too many, and its
 * payroll-create approval it carried is retired with it.
 */
export default {
	description:
		'Manager: reads people operations across the company and owns their team’s time and leave.',
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
		...referenceGrants('read'),
		...statutoryGrants('read'),
		...peopleGrants('read'),
		...grantsOn('time_entries', ['read']),
		...grantsOn('leave_requests', ['read']),
		// Restated, not inherited, and restated *with* the predicate. A manager who could see
		// corrections could reconstruct what HR fixed about their own team's pay.
		...grantsOnWhere('component_entries', ['read'], NOT_AN_ADJUSTMENT),
		...settlementLedgerGrants(),

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

		{
			collection: 'leave_requests',
			action: 'create',
			approval: leaveApproval
		},
		{ collection: 'leave_requests', action: 'update' },
		{ collection: 'leave_requests', action: 'delete' }
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
