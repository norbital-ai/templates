import { refuse } from '@norbital-ai/bolt/authoring';
import { toMinorUnits } from '@norbital-ai/std/finance';
import type { LeaveSubmission } from '../../leave/activity.js';
import type { LeaveBalanceSummaries } from '../../leave/summary.js';

type OffboardingSummary = LeaveBalanceSummaries[number];

export type OffboardingChoice = {
	/** True encashes the whole remaining balance; false forfeits it and writes nothing. */
	readonly encash: boolean;
	/** The agreed gross in the jurisdiction currency; payroll never reprices it. */
	readonly gross: number;
	/** Optional entered rate explaining the gross; days × rate must equal it. */
	readonly rate: number | null;
};

/** The departure reasons the employments model offers; the hook records whichever is chosen. */
export const EXIT_REASONS = [
	'RESIGNATION',
	'END_OF_CONTRACT',
	'TERMINATION',
	'RETRENCHMENT',
	'MISCONDUCT',
	'RETIREMENT',
	'DEATH',
	'OTHER'
] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

export type OffboardingDeparture = {
	readonly id: string;
	readonly exit_date: string;
	readonly exit_reason: string;
	readonly exit_note: string | null;
};

/** Days the step may encash for one leave type: the reserved balance, else null. */
export function encashableBalance(summary: OffboardingSummary): number | null {
	return summary.available != null && summary.available > 0 ? summary.available : null;
}

/** Deterministic per employment and leave, so a retried submit never double-pays. */
export function exitReference(employmentId: string, leaveCode: string): string {
	return `exit:${employmentId}:${leaveCode}`;
}

/**
 * The off-boarding writes: one departure update plus one `ENCASHMENT` submission per encashed
 * leave type, each carrying the full remaining balance on the last day. Forfeit writes nothing;
 * the balance ends with the contract. The caller submits the encashments first so a refused
 * entry refuses the whole off-boarding before the departure is recorded.
 */
export function buildOffboardingWrites(options: {
	readonly employmentId: string;
	/** Last day of work, `YYYY-MM-DD`; the contract's effective end follows it. */
	readonly lastDay: string;
	readonly reason: string;
	readonly note: string | null;
	readonly summaries: readonly OffboardingSummary[];
	readonly choices: Readonly<Record<string, OffboardingChoice>>;
	readonly currency: string;
}): { readonly departure: OffboardingDeparture; readonly encashments: readonly LeaveSubmission[] } {
	const { employmentId, lastDay, reason, note, summaries, choices, currency } = options;
	if (lastDay.trim() === '') refuse('Off-boarding needs a last day of work.');
	if (reason.trim() === '') refuse('Off-boarding needs a reason.');
	const encashments = summaries.flatMap((summary): readonly LeaveSubmission[] => {
		if (!choices[summary.code]?.encash) return [];
		const days = encashableBalance(summary);
		if (days == null) refuse(`${summary.code} has no remaining balance to encash.`);
		const choice = choices[summary.code]!;
		if (!Number.isFinite(choice.gross) || choice.gross <= 0)
			refuse(`An encashment for ${summary.code} needs a positive agreed amount.`);
		if (
			choice.rate != null &&
			toMinorUnits(days * choice.rate, currency) !== toMinorUnits(choice.gross, currency)
		)
			refuse('Days multiplied by the entered rate must equal the agreed gross amount.');
		return [
			{
				employment_id: employmentId,
				leave_catalogue_id: summary.catalogue_id,
				reference: exitReference(employmentId, summary.code),
				event: {
					kind: 'ENCASHMENT',
					source_window: { start: summary.window.start, end: summary.window.end },
					days,
					gross_amount: { value: choice.gross, currency },
					rate: choice.rate,
					effective_on: lastDay,
					due_on: lastDay,
					reason: note
				}
			}
		];
	});
	return {
		departure: { id: employmentId, exit_date: lastDay, exit_reason: reason, exit_note: note },
		encashments
	};
}
