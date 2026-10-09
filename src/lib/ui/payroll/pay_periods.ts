/**
 * The pay periods the UI offers, from the engine's effective-dated schedule: `periodsIn` cuts each month by the
 * frequency in force on its days (`pay_frequency`, then each `pay_frequency_changes` switch), so a month that switches
 * offers each frequency's own periods over its own days.
 */
import { addMonths } from '@norbital-ai/std/date';
import {
	type FrequencyChange,
	payPeriodWindow,
	periodsIn
} from '../../payroll_engine/foundation.js';

export type PayingEntity = {
	readonly pay_frequency?: string | null;
	readonly pay_frequency_changes?: readonly FrequencyChange[] | null;
	readonly pay_cutoff_day?: number | null;
};

export type OfferedPeriod = {
	readonly key: string;
	readonly frequency: string;
	readonly from: string;
	readonly to: string;
};

/** The month (`YYYY-MM`) `back` months before `month`. */
const monthBefore = (month: string, back: number): string =>
	String(addMonths(`${month}-01`, -back)).slice(0, 7);

/** The periods of the `months` months ending with `today`'s, newest month first, none starting after today. */
export const periodOptions = (
	entity: PayingEntity,
	today: string,
	months = 12
): readonly OfferedPeriod[] =>
	Array.from({ length: months }, (_, back) => monthBefore(today.slice(0, 7), back)).flatMap(
		(month) => periodsIn(entity, month).filter((period) => period.from <= today)
	);

/**
 * The period a page steps by in `chosen`'s month: `chosen` when the month offers it, else the offered period holding
 * `today`, else the month's first; its `window` is the days whose entries settle in it — the period's own days, moved
 * by the entity's cutoff day as the run's attendance is. Null when the month offers none.
 */
export const periodIn = (
	entity: PayingEntity,
	chosen: string,
	today: string
): (OfferedPeriod & { readonly window: { readonly from: string; readonly to: string } }) | null => {
	const offered = periodsIn(entity, chosen.slice(0, 7));
	const period =
		offered.find((row) => row.key === chosen) ??
		offered.find((row) => row.from <= today && today <= row.to) ??
		offered[0];
	if (period == null) return null;
	const cutoff = entity.pay_cutoff_day ?? 0;
	const window =
		cutoff === 0
			? { from: period.from, to: period.to }
			: (() => {
					const moved = payPeriodWindow(period.key, {
						pay_frequency: period.frequency,
						pay_cutoff_day: cutoff
					});
					return { from: moved.start, to: moved.end };
				})();
	return { ...period, window };
};
