/**
 * L-TPL-hr-payroll-034: close a contract once. Last day is inclusive; `behaviour_taps` then applies
 * `encash-leave-on-exit` from the written `exit_facts` (L-TPL-hr-payroll-076).
 */
import type { DatePeriod } from '@norbital-ai/std/date';
import { PlainDate } from '@norbital-ai/std/date';

export type ExitFacts = {
	readonly ground: string;
	readonly last_day: string;
	readonly note?: string;
};

export function lastDayRefusal(
	hireFrom: string,
	lastDay: string | null | undefined
): string | null {
	if (lastDay == null || lastDay === '')
		return `Choose a last day of work on or after the hire date (${hireFrom}).`;
	if (lastDay < hireFrom)
		return `Choose a last day of work on or after the hire date (${hireFrom}).`;
	return null;
}

/** Null when the update is admitted; otherwise the refusal. A closed range is never reopened or moved. */
export function refuseClosedUpdate(
	before: { readonly effective_range: { readonly from: string; readonly to: string | null } },
	set: { readonly effective_range?: { readonly from: string; readonly to: string | null } | null }
): string | null {
	const was = before.effective_range;
	if (was.to != null) {
		if (set.effective_range === undefined) return null;
		if (set.effective_range == null)
			return 'This contract has ended; departure closes its range once.';
		if (set.effective_range.from !== was.from || set.effective_range.to !== was.to)
			return 'This contract has ended; departure closes its range once.';
		return null;
	}
	if (set.effective_range?.to == null) return null;
	return lastDayRefusal(was.from, set.effective_range.to);
}

export type ClosedContractSet = {
	readonly effective_range: DatePeriod;
	readonly exit_ground: string;
	readonly exit_facts: ExitFacts;
};

/** Writes after `lastDayRefusal` is null. The last day is not re-checked here. */
export function closeContractWrites(input: {
	readonly from: string;
	readonly lastDay: string;
	readonly ground?: string;
	readonly note?: string;
}): ClosedContractSet {
	const ground =
		input.ground?.trim() === '' || input.ground == null ? 'RESIGNATION' : input.ground.trim();
	const note = input.note?.trim();
	return {
		effective_range: { from: PlainDate(input.from), to: PlainDate(input.lastDay) },
		exit_ground: ground,
		exit_facts: {
			ground,
			last_day: input.lastDay,
			...(note == null || note === '' ? {} : { note })
		}
	};
}
