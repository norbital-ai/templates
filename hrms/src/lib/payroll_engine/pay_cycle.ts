import { DateTime } from 'effect';
import type { PlainDate } from '@norbital-ai/bolt';
import { type JsonObject } from './foundation.js';

export interface PayWindow {
	readonly from: string;
	readonly to: string;
}
export interface PayCycle extends PayWindow {
	/** The month (`2026-05`), or the month and its part (`2026-05-2`). */
	readonly key: string;
}

/** The last day of each part but the final one, which runs to the month's end. */
const PARTS: Readonly<Record<string, readonly number[]>> = {
	MONTHLY: [],
	INTEGER_MONTHS: [],
	SEMI_MONTHLY: [15],
	TEN_DAY: [10, 20]
};

/** The cycles a month holds. A weekly or daily schedule has none yet: it pays through an off-cycle run. */
export const cyclesIn = (schedule: JsonObject, month: string): readonly PayCycle[] => {
	const parts = PARTS[String(schedule.frequency)];
	if (parts === undefined) return [];
	const start = `${month}-01`;
	const last = DateTime.formatIsoDate(DateTime.endOf(DateTime.makeUnsafe(start), 'month'));
	if (parts.length === 0) return [{ key: month, from: start, to: last }];
	const ends = [
		...parts.map((day) =>
			DateTime.formatIsoDate(DateTime.setPartsUtc(DateTime.makeUnsafe(start), { day }))
		),
		last
	];
	return ends.map((to, index) => ({
		key: `${month}-${index + 1}`,
		from:
			index === 0
				? start
				: DateTime.formatIsoDate(
						DateTime.add(DateTime.makeUnsafe(ends[index - 1] ?? start), { days: 1 })
					),
		to
	}));
};

export const cycleOf = (schedule: JsonObject, key: string): PayCycle | undefined =>
	cyclesIn(schedule, key.slice(0, 7)).find((cycle) => cycle.key === key);

/** The cycle holding a day. */
export const cycleOn = (schedule: JsonObject, day: string): PayCycle | undefined =>
	cyclesIn(schedule, day.slice(0, 7)).find((cycle) => cycle.from <= day && day <= cycle.to);

/** The day a cycle pays: its `pay_days` entry, kept inside its month and moved off the non-working days. */
export const payDateOf = (schedule: JsonObject, key: string): PlainDate => {
	const days = Array.isArray(schedule.pay_days) ? schedule.pay_days : [];
	const part = Number(key.slice(8) || 1);
	const day = Number(days[part - 1] ?? days.at(-1) ?? 0);
	const first = key.slice(0, 7);
	const end = DateTime.formatIsoDate(DateTime.endOf(DateTime.makeUnsafe(`${first}-01`), 'month'));
	const wanted =
		day > 0
			? DateTime.formatIsoDate(DateTime.setPartsUtc(DateTime.makeUnsafe(`${first}-01`), { day }))
			: end;
	let date = wanted > end ? end : wanted;
	const off = Array.isArray(schedule.non_working_weekdays) ? schedule.non_working_weekdays : [];
	const step = schedule.business_day === 'PREVIOUS' ? -1 : schedule.business_day === 'NEXT' ? 1 : 0;
	while (step !== 0 && off.includes(DateTime.getPartUtc(DateTime.makeUnsafe(date), 'weekDay')))
		date = DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(date), { days: step }));
	return date;
};

/**
 * The attendance a cycle pays. A cutoff of 1 attends the salary days; a later one attends from last month's cutoff to
 * the day before this one, and a half-month cycle attends the half before it.
 */
export const attendanceOf = (schedule: JsonObject, salary: PayWindow): PayWindow => {
	const day = Number(schedule.pay_cutoff_day ?? 1);
	if (day <= 1) return salary;
	if (schedule.frequency === 'SEMI_MONTHLY') {
		const to = DateTime.formatIsoDate(DateTime.add(DateTime.makeUnsafe(salary.from), { days: -1 }));
		const cycle = cycleOn(schedule, to);
		return cycle === undefined ? salary : { from: cycle.from, to: cycle.to };
	}
	const cutoff = DateTime.setPartsUtc(DateTime.makeUnsafe(salary.from), { day });
	return {
		from: DateTime.formatIsoDate(DateTime.subtract(cutoff, { months: 1 })),
		to: DateTime.formatIsoDate(DateTime.subtract(cutoff, { days: 1 }))
	};
};

/** The payroll period a day falls in, by the entity's own schedule: monthly, semi-monthly or ten-day. */
export const payPeriodOf = (date: string, schedule: JsonObject): string => {
	const month = date.slice(0, 7);
	const dayOf = Number(date.slice(8, 10));
	const frequency = String(schedule.frequency ?? 'MONTHLY');
	const cutoff = Number(schedule.pay_cutoff_day ?? 1);
	const next = DateTime.formatIsoDate(
		DateTime.add(DateTime.startOf(DateTime.makeUnsafe(date), 'month'), { months: 1 })
	).slice(0, 7);
	if (frequency === 'TEN_DAY')
		return cutoff <= 1
			? `${month}-${Math.ceil(dayOf / 10)}`
			: dayOf < cutoff
				? `${month}-1`
				: `${next}-1`;
	if (frequency !== 'SEMI_MONTHLY') return cutoff > 1 && dayOf >= cutoff ? next : month;
	const part = dayOf <= 15 ? 1 : 2;
	if (cutoff <= 1) return `${month}-${part}`;
	return part === 1 ? `${month}-2` : `${next}-1`;
};
