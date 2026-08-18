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
 * Rank 3 of 4. A supervisor, plus the authority to withdraw rather than only to raise.
 *
 * The whole of the supervisor's set is composed again here rather than inherited, because there is
 * no inheritance to inherit through: `subjectHasPolicy` matches a subject to a policy by role, so a
 * person carrying only `manager` matches only this file and is granted only what this file lists.
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
 * payroll-create approval config `019efa4d-0a10-7a04-8b04-000000000008` is retired with it.
 */
export default {
	name: 'manager',
	description:
		'Manager: reads people operations across the company and owns their team’s time and leave.',
	apps: ['hr_controller'],
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
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-000000000310')
		},
		{
			collection: 'time_entries',
			action: 'update',
			approval: timeEntryApproval('019efa4d-0a10-7a04-8b04-000000000320')
		},
		{ collection: 'time_entries', action: 'delete' },

		{
			collection: 'leave_requests',
			action: 'create',
			approval: leaveApproval('019efa4d-0a10-7a04-8b04-000000000330')
		},
		{ collection: 'leave_requests', action: 'update' },
		{ collection: 'leave_requests', action: 'delete' }
	]
} satisfies Policy;
