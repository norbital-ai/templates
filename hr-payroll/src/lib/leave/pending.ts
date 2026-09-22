import { refuse } from '@norbital-ai/bolt/authoring';
import type { WorkspaceRow } from '../../collections/leave_entries/$types.js';

export type LeaveActivity = Pick<
	WorkspaceRow<'leave_entries'>,
	| 'id'
	| 'employment_id'
	| 'catalogue_id'
	| 'leave_code'
	| 'reference'
	| 'from_date'
	| 'to_date'
	| 'half_day_start'
	| 'half_day_end'
	| 'days'
	| 'encash_days'
	| 'as_adjustment_entry'
	| 'reversal_of_id'
	| 'effective_on'
	| 'due_on'
	| 'destination_from'
	| 'destination_to'
	| 'available_from'
	| 'expires_on'
	| 'reason'
	| 'charges'
	| 'allocations'
	| 'approval_id'
	| 'payslip_id'
	| 'event_kind'
	| 'event_relationship'
	| 'event_date'
> &
	/** Hourly leave's own hours, one day at a time; payroll reads them where the day is charged by the hour. */
	Partial<Pick<WorkspaceRow<'leave_entries'>, 'hours'>>;

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
