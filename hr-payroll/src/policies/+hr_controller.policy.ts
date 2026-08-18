import {
	grantsOn,
	leaveApproval,
	payrollGrants,
	payrollRunApprovalFromController,
	peopleGrants,
	referenceGrants,
	statutoryGrants,
	timeEntryApproval
} from '../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * Special role 1 of 2. HR administration, and the one role that may look at payroll without being
 * able to commit it.
 *
 * The owner's words: an `hr_controller` **may view** payroll and **may not create** it; a create
 * raised by a controller requires approval from `hr_manager` or senior management. Those are three
 * separate statements about three different grants and they are written out below rather than
 * summarised:
 *
 *   - `payrollGrants('read')` — the view. All four payroll collections.
 *   - `payroll_runs: create` **carrying an approval** — the create that is not a create. Bolt writes
 *     the row and immediately stamps `norbital_approval_id`, so the controller gets a run to inspect
 *     and nobody gets a payroll that has not been agreed to.
 *   - no `payroll_runs: update`, no `payroll_runs: delete` — a controller does not re-run a payroll
 *     and does not erase one. That is what "may not create it" means once the run exists.
 *
 * There is deliberately no `payslips`/`payslip_lines`/`payroll_settlements` delete grant either.
 * `clearRunResults` needs those to rebuild a draft, and a controller never rebuilds one: their only
 * write is the initial create, and a run with no payslips yet has nothing to clear. See
 * `payrollRebuildGrants` in `src/lib/policy_grants.ts`, which is the grant `hr_manager` and
 * `senior_management` hold instead.
 *
 * Kept generated, because the groups are what the policy actually says. `referenceGrants` with four
 * actions beside `statutoryGrants` with one is a rule you can read — a company owns its configuration
 * and only reads the law — and it vanishes into eighty indistinguishable lines once flattened. The
 * exceptions are written out below the generated blocks, which is where the interesting part of any
 * permission set lives. See `src/lib/policy_grants.ts` for why the groups are functions.
 *
 * The gated grants carry their approval config and step **ids** verbatim from the policy this one
 * succeeds. Those ids are not decorative: an existing `approval_request` resolves its
 * `approval_config_id` by scanning grants for a matching `norbital_id`, so reissuing one would leave
 * every in-flight and historical request unable to name the flow that produced it. The payroll-run
 * config keeps id `…000007` for that reason even though its approver set has widened — the flow is
 * the same flow, decided by a larger room.
 *
 * `apps: ['hr_controller']` names the app *group*, as the seed did. Eight apps sit under it and
 * `appAccessAllowed` matches a group prefix, so this is one grant rather than eight — and, unlike
 * eight, it still covers the ninth when somebody adds it.
 */
export default {
	name: 'hr_controller',
	description:
		'HR administration across people, scheduling, requests, loans and adjustments, with payroll visible but not committable.',
	apps: ['hr_controller'],
	grants: [
		...referenceGrants('read', 'create', 'update', 'delete'),
		...statutoryGrants('read'),
		...peopleGrants('read'),
		...peopleGrants('create', 'update', 'delete'),
		...grantsOn('time_entries', ['read']),

		/**
		 * The adjustment path, unconditional and stated here rather than folded into `peopleGrants`.
		 *
		 * This is the whole of "only HR-policy holders may create adjustments": no policy on the
		 * ordinary ladder has a `component_entries` create grant at all, and the `employee` policy's is
		 * pinned to `origin.kind = 'CLAIM'`. There is nothing to subtract, because nothing below was
		 * ever added.
		 *
		 * Unconditional on read, too, which is the other half of the rule — `NOT_AN_ADJUSTMENT` is
		 * absent here on purpose, so a controller sees the corrections everyone below them cannot.
		 *
		 * No approval step. The owner gated exactly one thing, the payroll run, and a gate nobody asked
		 * for would leave every correction to a settled payslip waiting on a signature — which is the
		 * situation adjustments exist to get out of.
		 */
		...grantsOn('component_entries', ['read', 'create', 'update', 'delete']),

		// Attendance becomes a payroll source, so writing it is reviewed. Deleting it is not, and that
		// asymmetry is the seed's: removing an entry withdraws a claim on payroll rather than making
		// one, and routing a withdrawal through the manager who would have to notice it only leaves the
		// bad row sitting in the run.
		{
			collection: 'time_entries',
			action: 'create',
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-000000000009')
		},
		{
			collection: 'time_entries',
			action: 'update',
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-00000000000a')
		},
		{ collection: 'time_entries', action: 'delete' },

		...grantsOn('leave_requests', ['read', 'update', 'delete']),
		{
			collection: 'leave_requests',
			action: 'create',
			approval: leaveApproval('019efa4d-0a10-7a04-8b04-000000000004')
		},

		...payrollGrants('read'),
		{
			collection: 'payroll_runs',
			action: 'create',
			approval: payrollRunApprovalFromController('019efa4d-0a10-7a04-8b04-000000000007')
		}
	]
} satisfies Policy;
