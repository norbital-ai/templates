import { addDays, addMonths, monthOf, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { isJsonObject, Refusal, type JsonObject } from './foundation.js';
import { queryRows, type Reader } from './reads.js';

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

/** The payroll period a day falls in, by the entity's own schedule: monthly, semi-monthly or ten-day. */
export const payPeriodOf = (date: string, schedule: JsonObject): string => {
	const month = date.slice(0, 7);
	const dayOf = Number(date.slice(8, 10));
	const frequency = String(schedule.frequency ?? 'MONTHLY');
	const cutoff = Number(schedule.pay_cutoff_day ?? 1);
	const shifted = (value: string, by: number) => addMonths(`${value}-01`, by).slice(0, 7);
	if (frequency === 'TEN_DAY')
		return cutoff <= 1
			? `${month}-${Math.ceil(dayOf / 10)}`
			: dayOf < cutoff
				? `${month}-1`
				: `${shifted(month, 1)}-1`;
	if (frequency !== 'SEMI_MONTHLY')
		return cutoff > 1 && dayOf >= cutoff ? shifted(month, 1) : month;
	const part = dayOf <= 15 ? 1 : 2;
	if (cutoff <= 1) return `${month}-${part}`;
	return part === 1 ? `${month}-2` : `${shifted(month, 1)}-1`;
};

/**
 * The paid-run lock for attendance: a roster day or an instalment dated in attendance an on-cycle run has already priced
 * would never be paid or deducted, so its write is refused. An unposted run is no run yet and blocks nothing.
 */
export const assertUnpriced = Effect.fn('payroll.assertUnpriced')(function* (
	read: Reader,
	days: readonly { readonly employment: string; readonly date: string }[],
	remedy: string
) {
	const [first] = days.map(({ date }) => date).sort();
	if (first === undefined) return;
	const known = yield* queryRows(read, {
		employee_contract: {
			where: { id: { in: [...new Set(days.map(({ employment }) => employment))] } },
			fields: ['pay_group_id'],
			limit: 10000
		},
		pay_group: { fields: ['payment_schedule'], limit: 10000 },
		// a day is attended by its own month's cycle or the next one's
		payroll_run: {
			where: { kind: { eq: 'ON_CYCLE' }, period: { gte: first.slice(0, 7) } },
			fields: ['pay_group_id', 'period'],
			limit: 10000
		}
	});
	// each person's days are priced by the runs of their own pay group, on its schedule
	const groupOf = new Map(
		(known.employee_contract ?? []).map((row) => [String(row.id), String(row.pay_group_id)])
	);
	const schedule = new Map(
		(known.pay_group ?? []).map((row) => [
			String(row.id),
			isJsonObject(row.payment_schedule) ? row.payment_schedule : {}
		])
	);
	const ran = new Set(
		(known.payroll_run ?? []).map((row) => `${String(row.pay_group_id)}/${String(row.period)}`)
	);
	const priced = days.find(({ employment, date }) => {
		const group = groupOf.get(employment) ?? '';
		return ran.has(`${group}/${payPeriodOf(date, schedule.get(group) ?? {})}`);
	});
	if (priced !== undefined)
		return yield* Effect.fail(
			new Refusal({
				message: `${priced.date} is in attendance a payroll run has already priced. ${remedy}`
			})
		);
});
