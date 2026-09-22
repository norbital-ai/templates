/**
 * Map-receiver functions over the person: `employee.age_on(date)` and `leave.taken(code)`, beside
 * the children's in `child-under.ts`. Registered on both engines.
 */
import { isCalendarDate } from '@norbital-ai/std/date';
import { decodeNumber } from '@norbital-ai/std/json';
import {
	addDays,
	completedMonths,
	completedYears,
	inclusiveDays,
	monthBounds,
	monthDay,
	shiftPeriod
} from '../../collections/payroll_runs/lib/dates.js';

/** The person's birth date and the day asked about, or null where either is missing or the day precedes the birth. */
function birthAndDay(employee: unknown, date: unknown): [string, string] | null {
	const born = String((employee as { birth_date?: unknown }).birth_date ?? '');
	const day = String(date).slice(0, 10);
	return born === '' || day < born ? null : [born, day];
}

/** `employee.age_on(date)`: completed years on that day, 0 with no birth date on record. */
export function ageOn(employee: unknown, date: unknown): bigint {
	const pair = birthAndDay(employee, date);
	return pair == null ? 0n : BigInt(completedYears(...pair));
}

/** `employee.age_months_on(date)`: completed months of age on that day (VN's retirement age is stated in years and months). */
export function ageMonthsOn(employee: unknown, date: unknown): bigint {
	const pair = birthAndDay(employee, date);
	return pair == null ? 0n : BigInt(completedMonths(...pair));
}

/** `leave.taken(code)`: the days of that code charged in the leave year before this day. */
export function leaveTaken(leave: unknown, code: unknown): number {
	const taken = (leave as { year_taken?: Record<string, unknown> }).year_taken;
	return decodeNumber(taken?.[String(code)] ?? 0);
}

/** Calendar anniversary matching age_on; a leap-day birth reaches the age on 1 March in a non-leap year. */
export function birthday(employee: unknown, age: unknown): string {
	const born = String((employee as { birth_date?: unknown }).birth_date ?? '');
	if (born === '') return '';
	const years = Number(age);
	const year = Number(born.slice(0, 4)) + years;
	if (!Number.isInteger(years) || years < 0 || year > 9999)
		throw new Error('Birthday age must name a non-negative whole-year anniversary.');
	const anniversary = `${String(year).padStart(4, '0')}${born.slice(4)}`;
	return isCalendarDate(anniversary) ? anniversary : `${String(year).padStart(4, '0')}-03-01`;
}

/**
 * What a person's earlier payslips and leave say, as the functions below read them: the rule date,
 * the morning after the last day served, each calendar month's wages by code (a payroll run's
 * payslip history; null where the site has none), and the approved time-off spans by leave code
 * (the leave site's; null elsewhere, read as none). A blank person carries an empty `as_of` and reads 0.
 */
export type PersonHistory = {
	readonly as_of: string;
	readonly through: string;
	readonly wages: Readonly<Record<string, Readonly<Record<string, number>>>> | null;
	readonly leave: ReadonlyArray<{
		readonly code: string;
		readonly from: string;
		readonly to: string;
	}> | null;
};

/** The paid wage every earlier payslip files under this name, month by month (see `earnedByMonth`). */
export const WAGES = 'WAGES';
/** A month's unpaid-leave deduction and charged days of one leave code, filed under these prefixes. */
export const LEAVE_ABSENCE = 'LEAVE_ABSENCE:';
export const LEAVE_DAYS = 'LEAVE_DAYS:';
/** A month's contract lines — the wage and standing allowances, as prorated — filed under this name. */
export const CONTRACT = 'CONTRACT';
/**
 * A month's days with overtime or night-window hours, each weighted by its payslip's monthly
 * minimum wage — Σ days × floor, as each payslip's trace recorded them.
 */
export const OVERTIME_FLOOR_DAYS = 'OVERTIME_FLOOR_DAYS:';

type Stint = { service_start?: unknown; exit_date?: unknown; history?: PersonHistory };

/**
 * The `months` calendar months before the rule date's month that the stint covered, each with the
 * days it covered, the month's days and what its payslips filed. Null for a blank person; a
 * covered month no earlier payslip settled is refused — the law reads wages received, and a
 * contract wage is not a substitute for them.
 */
function wageMonths(employment: unknown, months: unknown, what: string) {
	const { service_start, exit_date, history } = employment as Stint;
	const start = String(service_start ?? '');
	const exit = String(exit_date ?? '');
	if (start === '' || history == null || history.as_of === '') return null;
	if (history.wages == null)
		throw new Error(`${what} reads earlier payslips, which only a payroll run supplies.`);
	const rows: {
		from: string;
		to: string;
		covered: number;
		days: number;
		codes: Readonly<Record<string, number>>;
	}[] = [];
	for (let offset = 1; offset <= Number(months); offset += 1) {
		const bounds = monthBounds(shiftPeriod(history.as_of.slice(0, 7), -offset));
		const from = start > bounds.start ? start : bounds.start;
		const to = exit !== '' && exit < bounds.end ? exit : bounds.end;
		if (from > to) continue;
		const month = bounds.start.slice(0, 7);
		const codes = history.wages[month];
		if (codes == null)
			throw new Error(
				`${what} needs the wages paid for ${month}, and no earlier payslip of this employee settles that month; record the figure on the departure where the law allows it, or run the missing month first.`
			);
		rows.push({
			from,
			to,
			covered: inclusiveDays(from, to),
			days: inclusiveDays(bounds.start, bounds.end),
			codes
		});
	}
	if (rows.length === 0)
		throw new Error(`${what} needs at least one month of service before ${history.as_of}.`);
	return rows;
}

/**
 * `employment.earned_monthly_average(months)`: the wages earlier payslips paid over the `months`
 * calendar months before the rule date's month, per month of service — a part first month counts
 * as its covered share (ID Permenaker 6/2016 art.3(3)–(4): the average wage received each month;
 * MY reg.6(2): twelve months' wages is twelve such months).
 */
export function earnedMonthlyAverage(employment: unknown, months: unknown): number {
	const rows = wageMonths(employment, months, 'Earned monthly average');
	if (rows == null) return 0;
	const wages = rows.reduce((sum, row) => sum + (row.codes[WAGES] ?? 0), 0);
	return wages / rows.reduce((sum, row) => sum + row.covered / row.days, 0);
}

/**
 * Wages over calendar days across the `months` months before the rule date's month (TW 勞基法
 * §2(4)), with the days 施行細則 §2 leaves out removed from both sides, and the covered months'
 * average length. 施行細則 §2: 下列各款期日或期間均不計入 — the day and the wages it carries.
 *
 * `codes` are left out for every calendar day their approved time off spans, paid or not (§2(2)
 * 職業災害醫療期間, §2(5) 普通傷病假, §2(7) 留職停薪): the spans are the leave entries' own dates.
 * `reduced` are left out only for the days they cut the wage (§2(3) 產假減半, §2(6) 生理假、產假、
 * 家庭照顧假…致減少工資者): the days their deduction lines charged. A left-out day takes with it
 * what it was paid — the contract's day (the month's contract lines over its covered days) less
 * that day's deduction, which the leave's own deduction added back restores.
 */
function dailyAverage(
	employment: unknown,
	months: unknown,
	codes: unknown,
	reduced: unknown,
	what: string
) {
	const rows = wageMonths(employment, months, what);
	if (rows == null) return null;
	const spanned = new Set((Array.isArray(codes) ? codes : []).map(String));
	const cut = (Array.isArray(reduced) ? reduced : []).map(String);
	const spans = ((employment as Stint).history?.leave ?? []).filter((span) =>
		spanned.has(span.code)
	);
	let wages = 0;
	let days = 0;
	for (const row of rows) {
		const out = new Set<string>();
		for (const span of spans) {
			const first = span.from > row.from ? span.from : row.from;
			const last = span.to < row.to ? span.to : row.to;
			for (let day = first; day <= last; day = addDays(day, 1)) out.add(day);
		}
		const reducedDays = cut.reduce((sum, code) => sum + (row.codes[LEAVE_DAYS + code] ?? 0), 0);
		const left = Math.min(row.covered, out.size + reducedDays);
		const addBack = [...spanned, ...cut].reduce(
			(sum, code) => sum + (row.codes[LEAVE_ABSENCE + code] ?? 0),
			0
		);
		const paid = row.codes[WAGES] ?? 0;
		const dayWage = (row.codes[CONTRACT] ?? paid + addBack) / row.covered;
		wages += paid + addBack - left * dayWage;
		days += row.covered - left;
	}
	if (days === 0) throw new Error(`${what} has no day left to divide by.`);
	const covered = rows.reduce((sum, row) => sum + row.covered, 0);
	const share = rows.reduce((sum, row) => sum + row.covered / row.days, 0);
	return { day: wages / days, monthDays: covered / share };
}

/** `employment.average_daily_wage(months, codes[, reduced])`: 平均工資 as a day (TW 勞基法 §2(4)). */
export function averageDailyWage(
	employment: unknown,
	months: unknown,
	codes: unknown,
	reduced: unknown = []
): number {
	return dailyAverage(employment, months, codes, reduced, 'Average daily wage')?.day ?? 0;
}

/**
 * `employment.average_monthly_wage(months, codes[, reduced])`: that day times the covered months'
 * average days — 勞動部 台(83)勞動二字第25564號: one month's average wage is the daily average × the
 * period's average days a month, which is six months' wages ÷ 6 where nothing is left out.
 */
export function averageMonthlyWage(
	employment: unknown,
	months: unknown,
	codes: unknown,
	reduced: unknown = []
): number {
	const average = dailyAverage(employment, months, codes, reduced, 'Average daily wage');
	return average == null ? 0 : average.day * average.monthDays;
}

/**
 * `employment.service_months_net(codes, days)`: completed months of service with the time off of
 * the named leave codes disregarded in every twelve months of service in which it exceeds `days`
 * in aggregate (MY EA s.60E(3B)). Twelve months are counted from the stint's start; a span counts
 * its calendar days.
 */
export function serviceMonthsNet(employment: unknown, codes: unknown, limit: unknown): bigint {
	const { service_start, history } = employment as Stint;
	const start = String(service_start ?? '');
	if (start === '' || history == null || history.as_of === '') return 0n;
	const named = new Set((Array.isArray(codes) ? codes : []).map(String));
	const year = Number(start.slice(0, 4));
	const month = Number(start.slice(5, 7)) - 1;
	const day = Number(start.slice(8, 10));
	let disregarded = 0;
	for (let index = 0; ; index += 1) {
		const from = monthDay(year, month + 12 * index, day);
		if (from >= history.through) break;
		const next = monthDay(year, month + 12 * (index + 1), day);
		const to = addDays(next < history.through ? next : history.through, -1);
		let taken = 0;
		// A person built without the leave record (outside the leave site) has none to net.
		for (const span of history.leave ?? []) {
			if (!named.has(span.code)) continue;
			const first = span.from > from ? span.from : from;
			const last = span.to < to ? span.to : to;
			if (first <= last) taken += inclusiveDays(first, last);
		}
		if (taken > Number(limit)) disregarded += taken;
	}
	return BigInt(completedMonths(addDays(start, disregarded), history.through));
}
