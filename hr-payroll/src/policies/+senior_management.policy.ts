import {
	grantsOn,
	leaveApproval,
	payrollGrants,
	payrollRebuildGrants,
	peopleGrants,
	referenceGrants,
	statutoryGrants,
	timeEntryApproval
} from '../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Rank 4 of 4, and the top of both columns.
 *
 * The owner names this rank twice: once as the highest ordinary level, and once beside `hr_manager`
 * as a role that **may view, create and run payroll**. So this file is the union of the manager
 * ladder and the HR manager's payroll authority, composed from the same builders both of them use.
 *
 * Spelled `senior_management`, not `senior management`. The role token is the policy name, folded,
 * and it is carried in credentials beside `hr_controller` and `hr_manager`; a token with a space in
 * it is a token that gets mistyped once and silently matches no policy at all — which fails as a
 * blank workspace rather than as an error.
 *
 * Everything is restated rather than inherited, for the reason given in the ladder in
 * `src/lib/policy_grants.ts`: there is no `extends` in the authoring surface and no rank in the
 * runtime, so a subject carrying only `senior_management` is granted exactly what this file lists.
 *
 * **Adjustments are visible here, and the ladder below cannot see them.** The owner scoped
 * adjustment visibility to `hr_controller`/`hr_manager`; senior management is included because this
 * role is one of the two the controller's payroll create escalates to, and approving a run whose
 * corrections you are forbidden to read is a signature on a figure you cannot check. That is a
 * choice, and the narrower reading — HR only — is one grant away: put `NOT_AN_ADJUSTMENT` on the
 * `component_entries` read below, exactly as `+manager.policy.ts` does.
 */
export default {
	name: 'senior_management',
	description:
		'Senior management: the full people-operations view, plus creating, running and deleting payroll runs.',
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
		// The ordinary ladder, widened: senior management writes the configuration a manager only reads.
		...referenceGrants('read', 'create', 'update', 'delete'),
		...statutoryGrants('read'),
		...peopleGrants('read'),
		...peopleGrants('create', 'update', 'delete'),
		...grantsOn('time_entries', ['read']),

		// Unconditional, so corrections are visible. See the note above for why this rank and not the
		// one below it.
		...grantsOn('component_entries', ['read', 'create', 'update', 'delete']),

		{
			collection: 'time_entries',
			action: 'create',
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-000000000410')
		},
		{
			collection: 'time_entries',
			action: 'update',
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-000000000420')
		},
		{ collection: 'time_entries', action: 'delete' },

		...grantsOn('leave_requests', ['read', 'update', 'delete']),
		{
			collection: 'leave_requests',
			action: 'create',
			approval: leaveApproval('019efa4d-0a10-7a04-8b04-000000000430')
		},

		// The payroll authority, identical to `hr_manager`'s. Stated as the same three builder calls so
		// that a change to what "running payroll" costs in permissions lands on both roles at once.
		...payrollGrants('read'),
		...payrollRebuildGrants(),
		...grantsOn('payroll_runs', ['create', 'update', 'delete'])
	]
} satisfies Policy;
