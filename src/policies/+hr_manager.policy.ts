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
 *     its `payroll_settlements` rows, which is what unlocks the time entries, component entries and
 *     leave requests that run consumed. `payroll_runs/+hooks.ts` refuses the delete outright once
 *     `lifecycle = 'PAID'`, so this grant can only ever release a draft's claims.
 *
 * The generated groups and the verbatim approval ids carry over from `+hr_controller.policy.ts` for
 * the reasons stated there; the time-entry and leave configs get their own ids, because the same flow
 * reached by a different role is a different config row and collapsing them would make a
 * manager-raised correction indistinguishable from a controller-raised one in the approval history.
 */
export default {
	name: 'hr_manager',
	description:
		'HR management: everything HR administration covers, plus creating, running and deleting payroll runs.',
	apps: ['hr_controller'],
	grants: [
		...referenceGrants('read', 'create', 'update', 'delete'),
		...statutoryGrants('read'),
		...peopleGrants('read'),
		...peopleGrants('create', 'update', 'delete'),
		...grantsOn('time_entries', ['read']),

		// The adjustment path. Unconditional on both read and create — see `+hr_controller.policy.ts`.
		...grantsOn('component_entries', ['read', 'create', 'update', 'delete']),

		{
			collection: 'time_entries',
			action: 'create',
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-000000000610')
		},
		{
			collection: 'time_entries',
			action: 'update',
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-000000000620')
		},
		{ collection: 'time_entries', action: 'delete' },

		...grantsOn('leave_requests', ['read', 'update', 'delete']),
		{
			collection: 'leave_requests',
			action: 'create',
			approval: leaveApproval('019efa4d-0a10-7a04-8b04-000000000630')
		},

		...payrollGrants('read'),
		...payrollRebuildGrants(),
		...grantsOn('payroll_runs', ['create', 'update', 'delete'])
	]
} satisfies Policy;
