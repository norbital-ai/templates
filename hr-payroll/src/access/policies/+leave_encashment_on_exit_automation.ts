import { grantsOn, hrLeaveEntryGrant, mergeGrants } from '../../lib/policy_grants.js';
import type { Policy } from './$types.js';

/**
 * The exit-encashment automation's authority, held by no human team.
 *
 * It reads what a leave balance is computed from and submits `leave_entries` through the same
 * grant an HR controller's manual encashment takes — `hrLeaveEntryGrant(true)`, whose route holds a
 * manual category for the HR Manager or Senior Management — so every entry it raises lands
 * provisionally, in their approval inbox, never as settled money. It holds no update, no delete
 * and nothing on the contract it reacts to.
 */
export default {
	description:
		'Raises a held ENCASHMENT leave entry for a leaver’s unused encashable balance when a contract closes; the HR Manager approves or rejects it. Reads only what the balance needs.',
	grants: mergeGrants(
		grantsOn('employments', ['read']),
		grantsOn('employees', ['read']),
		grantsOn('companies', ['read']),
		grantsOn('employment_terms', ['read']),
		grantsOn('jurisdiction_settings', ['read']),
		grantsOn('leave_catalogue', ['read']),
		grantsOn('jurisdiction_holidays', ['read']),
		grantsOn('shift_patterns', ['read']),
		grantsOn('shift_definitions', ['read']),
		grantsOn('work_days', ['read']),
		grantsOn('payroll_runs', ['read']),
		grantsOn('payslips', ['read']),
		grantsOn('leave_entries', ['read']),
		hrLeaveEntryGrant(true)
	),
	limits: { 'collections.*': { window: '1 min', limit: 600, key: 'subject' } }
} satisfies Policy;
