import { refuse } from '../refuse.js';
import type { LeaveEntryActivity } from './activity-fields.js';
import type { LeaveAllocation } from '../datatypes/leave_allocations.js';
import type { LeaveCharge } from '../datatypes/leave_charges.js';

/** One leave entry as the planner reads it: decimals as numbers, days as calendar days. */
export type LeaveActivity = Required<
	Omit<
		LeaveEntryActivity,
		| 'hours'
		| 'no_pay_origin'
		| 'event_child_index'
		| 'event_wife_prior_living_biological_children'
		| 'agreed_pay_fraction'
	>
> &
	Pick<
		LeaveEntryActivity,
		| 'hours'
		| 'no_pay_origin'
		| 'event_child_index'
		| 'event_wife_prior_living_biological_children'
		| 'agreed_pay_fraction'
	> & {
		readonly id: string;
		readonly employment_id: string;
		readonly catalogue_id: string;
		readonly leave_code: string;
		readonly reference: string;
		readonly certificate_file?: unknown;
		readonly charges: readonly LeaveCharge[];
		readonly allocations: readonly LeaveAllocation[];
		readonly approval_id: string | null;
		readonly payslip_id: string | null;
	};

/**
 * Held activity reserves its original server-measured debits until approval or rejection.
 *
 * A held proposal is a committed row stamped `approval_id`, read with the rest: its charges and
 * allocations are the transform's, so it reserves exactly what it measured. A held row is never
 * a settled one — payroll consumes only rows in force — so its pin reads as absent.
 */
export function withPendingLeaveEntries(
	pending: readonly LeaveActivity[],
	stored: readonly LeaveActivity[]
): LeaveActivity[] {
	if (pending.length >= 2000)
		refuse('The pending leave read reached its safety ceiling; the balance cannot be verified.');
	return [...stored, ...pending.map((row) => ({ ...row, payslip_id: null }))];
}
