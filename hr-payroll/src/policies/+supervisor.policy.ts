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
} from '../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Rank 2 of 4. The first line: sees the team, acts on their time and leave, touches no payroll.
 *
 * Everything an employee may do is *not* repeated here, and that is deliberate rather than an
 * omission. A supervisor is also an employee, so they carry the `employee` role alongside this one
 * and `rowPredicate` unions the two policies' grants — their own payslip stays reachable through
 * `employee`, scoped to them, without this policy having to restate a self-service predicate it
 * would then have to keep in step. What this policy adds is the *team* view, which is the only
 * thing rank is about. See the ladder in `src/lib/policy_grants.ts`.
 *
 * The team view is company-wide, not reports-only, and that is a limit of the data rather than a
 * decision: nothing in `employments` or `employees` records a reporting line, so "their own reports"
 * cannot be written as a row predicate today. The direct-manager gate is not lost — it lives where
 * this template already put it, in the `L1 Manager` approval step every time-entry and leave write
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
	name: 'supervisor',
	description:
		'First-line supervisor: reads the team, reviews and records their attendance and leave.',
	/**
	 * Self-service first, because it is the one app nobody's rank gates.
	 *
	 * `hr_employee` shows a person their own employment: their payslips, their leave balance, their
	 * roster. Every rung of this ladder is somebody's employee, so every rung has one — and until now
	 * only `employee` listed it, which meant an HR manager could run the company's payroll and not
	 * look at their own. It is listed on every policy rather than inherited because there is nothing
	 * to inherit through: `visibleApps` reads the `apps` array of the policies a subject's roles
	 * match, and a policy that does not name the app does not offer it.
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
	apps: ['hr_employee'],

	grants: [
		...referenceGrants('read'),
		...statutoryGrants('read'),
		...peopleGrants('read'),
		...grantsOn('time_entries', ['read']),
		...grantsOn('leave_requests', ['read']),
		// The narrowing has to be stated here, not subtracted higher up: one unconditional
		// `component_entries` read in any policy this subject matches would erase it.
		...grantsOnWhere('component_entries', ['read'], NOT_AN_ADJUSTMENT),
		...settlementLedgerGrants(),

		// Attendance becomes a payroll source, so writing it is reviewed by the direct manager even
		// when a supervisor is the one writing it. Their own config ids: the same flow reached by a
		// different role is a different config row, and collapsing them would make a supervisor-raised
		// correction indistinguishable from HR's in the approval history.
		{
			collection: 'time_entries',
			action: 'create',
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-000000000210')
		},
		{
			collection: 'time_entries',
			action: 'update',
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-000000000220')
		},

		// Raising leave is reviewed; amending one already raised is not. A supervisor amending a
		// request is acting as its reviewer, so routing that back through review would ask them to
		// approve themselves. Deleting is not theirs — a withdrawal at this rank goes to a manager.
		{
			collection: 'leave_requests',
			action: 'create',
			approval: leaveApproval('019efa4d-0a10-7a04-8b04-000000000230')
		},
		{ collection: 'leave_requests', action: 'update' }
	]
} satisfies Policy;
