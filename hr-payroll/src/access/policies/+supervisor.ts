import {
	NOT_AN_ADJUSTMENT,
	employeeSelfServiceGrants,
	grantOn,
	grantsOn,
	leaveApproval,
	mergeGrants,
	peopleGrants,
	referenceGrants,
	settlementLedgerGrants,
	statutoryGrants,
	timeEntryApproval
} from '../../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Rank 2 of 4. The first line: sees the team, acts on their time and leave, touches no payroll.
 *
 * The supervisor policy materializes the employee-facing grant surface it needs; the team holds
 * this policy alone. Its two personal pay capabilities come from one shared scoped helper, while
 * the broader people, time and leave grants below state the team view. This avoids composing an
 * employee narrowing with an unconditional supervisor grant that would erase it at runtime. See
 * the ladder in `src/lib/policy_grants.ts`.
 *
 * The team view is company-wide, not reports-only, and that is a limit of the data rather than a
 * decision: nothing in `employments` or `employees` records a reporting line, so "their own reports"
 * cannot be written as a row predicate today. The direct-manager gate is not lost — it lives where
 * this template already put it, in the `L1 Manager` approval flow every time-entry and leave write
 * below routes to. Inventing a `manager_id` column to narrow the read would be a schema change made
 * to satisfy a policy comment, and it would still be unpopulated.
 *
 * No `payroll_runs`, `payslips` or `payslip_lines` grant of any kind. Viewing payroll is enumerated
 * authority held by `hr_controller`, `hr_manager` and `senior_management`; it is not something rank
 * accumulates. The `hr_controller` app group is still granted so the review screens are reachable,
 * and the payroll screen inside it renders empty — which is the correct outcome: navigation is not
 * authority, the grant is.
 */
export default {
	description:
		'First-line supervisor: reads the team, reviews and records their attendance and leave.',
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
	capabilities: { apps: ['hr_employee'] },

	grants: mergeGrants(
		employeeSelfServiceGrants(),
		referenceGrants('read'),
		statutoryGrants('read'),
		peopleGrants('read'),
		grantsOn('time_entries', ['read']),
		grantsOn('leave_requests', ['read']),
		// The narrowing has to be stated here, not subtracted higher up: one unconditional
		// `component_entries` read in any policy this subject matches would erase it.
		grantOn('component_entries', 'read', {
			where: NOT_AN_ADJUSTMENT,
			dependencies: []
		}),
		settlementLedgerGrants(),

		// Attendance becomes a payroll source, so writing it is reviewed by the direct manager even
		// when a supervisor is the one writing it. Runtime derives the durable configuration identity
		// from this policy and grant coordinate, keeping its history distinct from HR's.
		grantOn('time_entries', 'create', { approval: timeEntryApproval }),
		grantOn('time_entries', 'update', { approval: timeEntryApproval }),

		// Raising leave is reviewed; amending one already raised is not. A supervisor amending a
		// request is acting as its reviewer, so routing that back through review would ask them to
		// approve themselves. Deleting is not theirs — a withdrawal at this rank goes to a manager.
		grantOn('leave_requests', 'create', { approval: leaveApproval }),
		grantsOn('leave_requests', ['update'])
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
