import { addDays, addMonths, monthOf, PlainDate } from '@norbital-ai/std/date';
import { isJsonObject, type JsonObject } from './foundation.js';

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

const pad = (day: number): string => String(day).padStart(2, '0');
const lastDay = (date: string): string => String(monthOf(date).to);

/** The cycles a month holds. A weekly or daily schedule has none yet: it pays through an off-cycle run. */
export const cyclesIn = (schedule: JsonObject, month: string): readonly PayCycle[] => {
	const parts = PARTS[String(schedule.frequency)];
	if (parts === undefined) return [];
	const start = `${month}-01`;
	if (parts.length === 0) return [{ key: month, from: start, to: lastDay(start) }];
	const ends = [...parts.map((day) => `${month}-${pad(day)}`), lastDay(start)];
	return ends.map((to, index) => ({
		key: `${month}-${index + 1}`,
		from: index === 0 ? start : String(addDays(ends[index - 1] ?? start, 1)),
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
	const end = lastDay(`${first}-01`);
	const wanted = day > 0 ? `${first}-${pad(day)}` : end;
	let date = wanted > end ? end : wanted;
	const off = Array.isArray(schedule.non_working_weekdays) ? schedule.non_working_weekdays : [];
	const step = schedule.business_day === 'PREVIOUS' ? -1 : schedule.business_day === 'NEXT' ? 1 : 0;
	while (step !== 0 && off.includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
		date = String(addDays(date, step));
	return PlainDate(date);
};

/**
 * The attendance a cycle pays. A cutoff of 1 attends the salary days; a later one attends from last month's cutoff to
 * the day before this one, and a half-month cycle attends the half before it.
 */
export const attendanceOf = (schedule: JsonObject, salary: PayWindow): PayWindow => {
	const day = Number(schedule.pay_cutoff_day ?? 1);
	if (day <= 1) return salary;
	if (schedule.frequency === 'SEMI_MONTHLY') {
		const to = String(addDays(salary.from, -1));
		const cycle = cycleOn(schedule, to);
		return cycle === undefined ? salary : { from: cycle.from, to: cycle.to };
	}
	const before = String(addDays(`${salary.from.slice(0, 7)}-01`, -1)).slice(0, 7);
	return {
		from: `${before}-${pad(day)}`,
		to: String(addDays(`${salary.from.slice(0, 7)}-${pad(day)}`, -1))
	};
};
