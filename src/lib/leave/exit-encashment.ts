import type { LeaveSubmission } from './activity.js';
import type { LeaveBalanceSummaries } from './summary.js';

/**
 * The one departure reason that never raises an automatic encashment. A dismissal is where every
 * jurisdiction's statutory payout has its exception (misconduct forfeits accrued leave), and the
 * engine carries no jurisdiction: HR enters a dismissed leaver's encashment by hand if it is owed.
 */
export const NO_AUTOMATIC_ENCASHMENT_EXIT = 'DISMISSAL';

/** Deterministic per employment and leave, so a retried run never double-pays. */
export function exitReference(employmentId: string, leaveCode: string): string {
	return `exit:${employmentId}:${leaveCode}`;
}

/**
 * The `ENCASHMENT` submissions a departure raises: the annual leave row, when its catalogue row is
 * `can_encash` and a balance is left on the last day — the whole balance, settling on that day. A
 * balance queried on the exit date of a closed contract is already bounded by it, so the available
 * quantity is the encashable one. A row whose reference is already on the record (posted or
 * awaiting approval) is skipped, which is the idempotency: the reference is the key, not the run.
 */
export function exitEncashments(options: {
	readonly employmentId: string;
	readonly exitDate: string;
	readonly summaries: LeaveBalanceSummaries;
	readonly encashable: ReadonlySet<string>;
	readonly posted: ReadonlySet<string>;
	readonly reason: string;
}): LeaveSubmission[] {
	return options.summaries.flatMap((summary) => {
		const reference = exitReference(options.employmentId, summary.code);
		if (
			!options.encashable.has(summary.catalogue_id) ||
			options.posted.has(reference) ||
			summary.available == null ||
			summary.available <= 0
		)
			return [];
		return [
			{
				employment_id: options.employmentId,
				catalogue_id: summary.catalogue_id,
				reference,
				from_date: summary.window.start,
				to_date: summary.window.end,
				days: summary.available,
				encash_days: summary.available,
				effective_on: options.exitDate,
				due_on: options.exitDate,
				reason: options.reason
			}
		];
	});
}
