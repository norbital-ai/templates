import { Effect } from 'effect';
import { addDays, days, monthOf } from '@norbital-ai/std/date';
import {
	payPeriodWindow,
	Refusal,
	stableJson,
	weeklyInstalments,
	type FrequencyChange,
	frequencyOn
} from './foundation.js';
import { type EntityRow } from './payslip/context.js';

const FREQUENCY: { readonly [frequency: string]: number } = {
	MONTHLY: 1,
	INTEGER_MONTHS: 1,
	SEMI_MONTHLY: 2,
	TEN_DAY: 3
};
/** A weekly month holds the Sunday–Saturday weeks starting in it; a daily month, its days. */

const partsIn = (frequency: string, month: string, weekStart = 0): number | undefined =>
	frequency === 'WEEKLY'
		? weeklyInstalments(month, weekStart).length
		: frequency === 'DAILY'
			? days(monthOf(`${month}-01`))
			: FREQUENCY[frequency];
/** Frequencies whose periods are not a cut of the month's attendance: no cutoff day moves them. */

export const CYCLES: readonly string[] = ['WEEKLY', 'DAILY'];

/** One settlement period inside its calendar month, and where it sits: part `part` of the month's `parts`. */

export type SettlementPeriod = {
	readonly from: string;
	readonly to: string;
	readonly part: number;
	readonly parts: number;
};

/**
 * A run's period key in its entity's grammar: `YYYY-MM` for a monthly entity, `YYYY-MM-<part>` (1-based) for a
 * sub-monthly one (`SEMI_MONTHLY` 1–15 / 16–end, `TEN_DAY` 1–10 / 11–20 / 21–end, `WEEKLY` the n-th Sunday–Saturday
 * week starting in the month), `YYYY-MM-DD` for a `DAILY` one (part = the day of the month).
 */

export const settlementPeriod = (
	period: string,
	frequency: string,
	/** The governing version's calendar: `payroll.week_start`, `payroll.semi_monthly_split`. */
	calendar: { readonly week_start?: number; readonly semi_monthly_split?: number } = {}
): Effect.Effect<SettlementPeriod, Refusal> => {
	const month = /^\d{4}-(0[1-9]|1[0-2])/.test(period) ? period.slice(0, 7) : null;
	const parts = month == null ? undefined : partsIn(frequency, month, calendar.week_start);
	if (parts == null && month != null)
		return Effect.fail(
			new Refusal({
				message: `Payroll frequency ${frequency} requires its own settlement calendar.`
			})
		);
	const shape =
		frequency === 'DAILY'
			? /^\d{4}-\d{2}-\d{2}$/
			: parts === 1
				? /^\d{4}-\d{2}$/
				: new RegExp(`^\\d{4}-\\d{2}-[1-${parts}]$`);
	if (parts == null || !shape.test(period))
		return Effect.fail(
			new Refusal({
				message:
					frequency === 'DAILY'
						? 'A DAILY payroll run needs its pay day as YYYY-MM-DD.'
						: parts === 1 || parts == null
							? 'A payroll run needs its pay period as YYYY-MM.'
							: `A ${frequency} payroll run needs its pay period as YYYY-MM-<1–${parts}>.`
			})
		);
	return Effect.try({
		try: () => {
			const { start, end } = payPeriodWindow(period, {
				pay_frequency: frequency,
				...(calendar.week_start == null ? {} : { week_start: calendar.week_start }),
				...(calendar.semi_monthly_split == null
					? {}
					: { semi_monthly_split: calendar.semi_monthly_split })
			});
			return { from: start, to: end, part: parts === 1 ? 1 : Number(period.slice(8)), parts };
		},
		catch: (cause) =>
			cause instanceof Refusal
				? cause
				: new Refusal({ message: 'A pay period requires its actual calendar month.' })
	});
};

/** The frequencies a switch may name: those that cut the calendar month. */
// ponytail: WEEKLY and DAILY periods straddle months; a switch to or from them needs a settlement across months

const SWITCHABLE: readonly string[] = ['MONTHLY', 'INTEGER_MONTHS', 'SEMI_MONTHLY', 'TEN_DAY'];

/**
 * Why an entity write would rewrite its pay schedule's history, if it would: `pay_frequency` is the frequency from the
 * start and stays once a salary run is paid at it; each `pay_frequency_changes` row switches it from its day, one a
 * day, to another of the month-cutting frequencies; no switch on or before `lastPaid` (the last day a salary run
 * covers) is added, moved or withdrawn, so a paid period keeps its frequency and no two periods cover one day.
 */

export const payScheduleRefusal = (
	before: Pick<EntityRow, 'pay_frequency' | 'pay_frequency_changes'>,
	after: Pick<EntityRow, 'pay_frequency' | 'pay_frequency_changes'>,
	lastPaid: string | null
): string | undefined => {
	const changes = (after.pay_frequency_changes ?? []).toSorted((a, b) =>
		a.from.localeCompare(b.from)
	);
	if (new Set(changes.map((change) => change.from)).size !== changes.length)
		return 'A pay schedule takes one switch a day.';
	for (const change of changes) {
		const was = frequencyOn(after, addDays(change.from, -1));
		for (const frequency of [was, change.frequency])
			if (!SWITCHABLE.includes(frequency))
				return `A switch to or from ${frequency} is not offered: its periods straddle calendar months, and a switched month settles by the calendar month. Switch between ${SWITCHABLE.join(', ')}.`;
		if (was === change.frequency)
			return `On ${change.from} the entity already pays ${change.frequency}.`;
	}
	if (lastPaid == null) return undefined;
	if ((before.pay_frequency ?? 'MONTHLY') !== (after.pay_frequency ?? 'MONTHLY'))
		return `A salary run already paid at ${before.pay_frequency ?? 'MONTHLY'}: record a switch from a day after ${lastPaid} instead.`;
	const paid = (list: readonly FrequencyChange[] | null | undefined) =>
		stableJson(
			(list ?? [])
				.filter((change) => change.from <= lastPaid)
				.toSorted((a, b) => a.from.localeCompare(b.from))
		);
	if (paid(before.pay_frequency_changes) !== paid(changes))
		return `Salary runs are paid through ${lastPaid}: a switch starts after that day.`;
	return undefined;
};

/**
 * A settlement period's salary and attendance windows. A cutoff day (2–28) moves the month's attendance to the
 * previous month's cutoff through the day before this month's; a part of the month moves by the same offset, the
 * month's last part ending where the month's attendance ends.
 */

export const payrollWindow = (
	settlement: SettlementPeriod,
	cutoff: number
): { salary_from: string; salary_to: string; attendance_from: string; attendance_to: string } => {
	const month = monthOf(settlement.from);
	const salary_from = settlement.from;
	const salary_to = settlement.to;
	if (!(cutoff >= 2 && cutoff <= 28))
		return { salary_from, salary_to, attendance_from: salary_from, attendance_to: salary_to };
	const stamp = new Date(`${String(month.from)}T00:00:00Z`);
	stamp.setUTCMonth(stamp.getUTCMonth() - 1, cutoff);
	const offset = (stamp.getTime() - Date.parse(`${String(month.from)}T00:00:00Z`)) / 86_400_000;
	return {
		salary_from,
		salary_to,
		attendance_from: addDays(salary_from, offset),
		attendance_to:
			salary_to === String(month.to)
				? `${salary_from.slice(0, 7)}-${String(cutoff - 1).padStart(2, '0')}`
				: addDays(salary_to, offset)
	};
};

/** One stored expression against its context; a failing or ill-typed expression refuses with its record named. */
