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
 * Rank 4 of 4, and the top of both columns.
 *
 * The owner names this rank twice: once as the highest ordinary level, and once beside `hr_manager`
 * as a role that **may view, create and run payroll**. So this file is the union of the manager
 * ladder and the HR manager's payroll authority, composed from the same builders both of them use.
 *
 * Spelled `senior_management`, not `senior management`, because the filename is the policy key.
 * `PolicyName` is generated from that key and consumed by the team declaration, so the human-facing
 * spelling stays in i18n instead of becoming a second authority name.
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
 * `component_entries` read below, exactly as `+manager.ts` does.
 */
export default {
	description:
		'Senior management: the full people-operations view, plus creating, running and deleting payroll runs.',
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
	capabilities: { apps: ['hr_employee'] },

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

		// The payroll authority, identical to `hr_manager`'s. Stated as the same three builder calls so
		// that a change to what "running payroll" costs in permissions lands on both policies at once.
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
