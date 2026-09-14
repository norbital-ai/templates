/**
 * The schedule-time limit gate of RFC 0001 §5.1 and §7.5.
 *
 * `work_rules.limits` are ceilings a plan may not breach: a day's normal, total and spread hours,
 * and a week, month, quarter or year of work and overtime. Payroll reports an overrun and still
 * prices it; the schedule is where the ceiling refuses, because a plan the law forbids should never
 * have been written. This module is that decision, pure, so the `work_days` hook and the
 * `shift_patterns` hook quote the same sentence.
 *
 * The projection is the pattern cycle plus the roster overlay: every date in the window resolves to
 * the roster code an explicit row names, else the code the pattern projects. A plan's paid minutes
 * are the net worked hours a limit is measured in; a CLOCK_HOURS day limit is evaluated against the
 * granted break exactly as the priced context evaluates it, so a twelve-hour clock day less a
 * one-hour break is eleven net worked hours.
 *
 * A projected overtime figure needs a normal day to measure beyond. It is the version's own day
 * `NORMAL_HOURS` limit where one is declared: with no normal stated every planned hour is normal
 * and overtime is attendance-only, which payroll still reports. Inventing a default normal here
 * would charge a schedule for a law the version never transcribed.
 */

import type { WorkLimit } from '../../datatypes/work_rules/+definition.js';

const DAY_MS = 86_400_000;

type SchedulePlanKind = 'WORK' | 'REST' | 'OFF';

/** One planned day, as the projection reads it. */
export type SchedulePlanDay = {
	readonly date: string;
	readonly kind: SchedulePlanKind | null;
	readonly paid_minutes: number;
	readonly break_minutes: number;
	/** Clock span the code's window covers, break included. Zero for a non-working day. */
	readonly spread_hours: number;
};

/** The roster-code facts a plan resolves to; `work_days` and `shift_patterns` both carry them. */
export type RosterCodeFacts = {
	readonly kind: SchedulePlanKind;
	readonly paid_minutes: number;
	readonly break_minutes: number;
	readonly spread_hours: number;
};

type LimitBreach = {
	readonly key: string;
	readonly period: WorkLimit['period'];
	readonly measure: WorkLimit['measure'];
	readonly date: string;
	readonly projected: number;
	readonly maximum: number;
	readonly message: string;
};

const PERIOD_RANK: Readonly<Record<WorkLimit['period'], number>> = {
	DAY: 0,
	WEEK: 1,
	MONTH: 2,
	QUARTER: 3,
	YEAR: 4
};

const PERIOD_LABEL: Readonly<Record<WorkLimit['period'], string>> = {
	DAY: 'day',
	WEEK: 'week',
	MONTH: 'month',
	QUARTER: 'quarter',
	YEAR: 'year'
};

const MEASURE_LABEL: Readonly<Record<WorkLimit['measure'], string>> = {
	TOTAL_WORK_HOURS: 'worked hours',
	OVERTIME_HOURS: 'overtime hours',
	NORMAL_HOURS: 'normal hours',
	SPREAD_HOURS: 'spread-over hours'
};

function dateMs(date: string): number {
	return Date.parse(`${date}T00:00:00.000Z`);
}

function addDays(date: string, days: number): string {
	return new Date(dateMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function weekStart(date: string): string {
	const day = (new Date(dateMs(date)).getUTCDay() + 6) % 7;
	return addDays(date, -day);
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function quarterKey(date: string): string {
	const [year, month] = date.split('-').map(Number);
	return `${year}-Q${Math.ceil((month ?? 1) / 3)}`;
}

function quarterBounds(date: string): { readonly start: string; readonly end: string } {
	const [year, month] = date.split('-').map(Number);
	const quarter = Math.ceil((month ?? 1) / 3);
	const firstMonth = (quarter - 1) * 3 + 1;
	return {
		start: `${year}-${String(firstMonth).padStart(2, '0')}-01`,
		end: `${year}-${String(firstMonth + 2).padStart(2, '0')}-${daysInMonth(year!, firstMonth + 2)}`
	};
}

/**
 * The window the limits need projected around a set of changed dates: the containing period of the
 * widest limit the version declares, aligned to that period's own boundaries. A caller reads the
 * plan for exactly this window and no more.
 */
export function projectionBounds(
	dates: readonly string[],
	limits: readonly WorkLimit[]
): { readonly start: string; readonly end: string } | null {
	if (dates.length === 0 || limits.length === 0) return null;
	const width = Math.max(...limits.map((limit) => PERIOD_RANK[limit.period]));
	const sorted = [...dates].toSorted();
	const first = sorted[0]!;
	const last = sorted.at(-1)!;
	if (width >= 4) return { start: `${first.slice(0, 4)}-01-01`, end: `${last.slice(0, 4)}-12-31` };
	if (width === 3) return { start: quarterBounds(first).start, end: quarterBounds(last).end };
	if (width === 2)
		return {
			start: `${first.slice(0, 7)}-01`,
			end: `${last.slice(0, 7)}-${daysInMonth(Number(last.slice(0, 4)), Number(last.slice(5, 7)))}`
		};
	if (width === 1) return { start: weekStart(first), end: addDays(weekStart(last), 6) };
	return { start: first, end: last };
}

/**
 * Every limit's value in net worked hours, exactly as work rules evaluate them: a CLOCK_HOURS day
 * limit subtracts the break the shift grants, every other limit states its figure directly.
 */
export function evaluatedLimits(
	limits: readonly WorkLimit[],
	breakMinutes: number
): Record<string, number> {
	const evaluated: Record<string, number> = {};
	for (const limit of limits) {
		evaluated[limit.key] =
			limit.period === 'DAY' && limit.unit === 'CLOCK_HOURS'
				? Math.max(0, limit.max_hours - breakMinutes / 60)
				: limit.max_hours;
	}
	return evaluated;
}

/** One date's resolution to a code's facts; a day no plan covers projects nothing. */
export function plannedDay(options: {
	readonly date: string;
	readonly rosterCodeId: string | null;
	readonly codeById: ReadonlyMap<string, RosterCodeFacts>;
}): SchedulePlanDay {
	const facts = options.rosterCodeId == null ? null : options.codeById.get(options.rosterCodeId);
	if (facts == null || facts.kind !== 'WORK')
		return {
			date: options.date,
			kind: facts?.kind ?? null,
			paid_minutes: 0,
			break_minutes: 0,
			spread_hours: 0
		};
	return {
		date: options.date,
		kind: 'WORK',
		paid_minutes: facts.paid_minutes,
		break_minutes: facts.break_minutes,
		spread_hours: facts.spread_hours
	};
}

/**
 * Every limit the changed dates breach, with the sentence a refusal quotes. Only periods a changed
 * date falls inside are judged: a plan edit elsewhere in the year is not this write's refusal.
 */
export function projectedLimitBreaches(options: {
	readonly subject: string;
	readonly changedDates: ReadonlySet<string>;
	readonly planByDate: ReadonlyMap<string, SchedulePlanDay>;
	readonly limits: readonly WorkLimit[];
	readonly authority?: string | null;
}): LimitBreach[] {
	const { limits } = options;
	if (limits.length === 0 || options.changedDates.size === 0) return [];
	const normal =
		limits.find(
			(limit) =>
				limit.period === 'DAY' && limit.measure === 'NORMAL_HOURS' && limit.unit === 'WORKED_HOURS'
		)?.max_hours ?? null;
	const hours = (plan: SchedulePlanDay | undefined): number =>
		plan != null && plan.kind === 'WORK' ? plan.paid_minutes / 60 : 0;
	const overtime = (plan: SchedulePlanDay | undefined): number =>
		normal == null ? 0 : Math.max(0, hours(plan) - normal);
	const spread = (plan: SchedulePlanDay | undefined): number =>
		plan != null && plan.kind === 'WORK' ? plan.spread_hours : 0;
	type Totals = { worked: number; overtime: number; spread: number };
	const totals = new Map<string, Totals>();
	const add = (period: string, key: string, plan: SchedulePlanDay | undefined): void => {
		const id = `${period}:${key}`;
		const row = totals.get(id) ?? { worked: 0, overtime: 0, spread: 0 };
		row.worked += hours(plan);
		row.overtime += overtime(plan);
		row.spread += spread(plan);
		totals.set(id, row);
	};
	for (const [date, plan] of options.planByDate) {
		add('WEEK', weekStart(date), plan);
		add('MONTH', date.slice(0, 7), plan);
		add('QUARTER', quarterKey(date), plan);
		add('YEAR', date.slice(0, 4), plan);
	}
	const periodKey = (period: WorkLimit['period'], date: string): string =>
		period === 'WEEK'
			? weekStart(date)
			: period === 'MONTH'
				? date.slice(0, 7)
				: period === 'QUARTER'
					? quarterKey(date)
					: date.slice(0, 4);
	const breaches: LimitBreach[] = [];
	const reported = new Set<string>();
	for (const date of [...options.changedDates].toSorted()) {
		const plan = options.planByDate.get(date);
		if (plan == null) continue;
		const evaluated = evaluatedLimits(limits, plan.break_minutes);
		const read = (limit: WorkLimit): number => {
			if (limit.period === 'DAY') {
				if (limit.measure === 'SPREAD_HOURS') return plan.spread_hours;
				if (limit.measure === 'OVERTIME_HOURS') return overtime(plan);
				return hours(plan);
			}
			const row = totals.get(`${limit.period}:${periodKey(limit.period, date)}`);
			if (row == null) return 0;
			if (limit.measure === 'SPREAD_HOURS') return row.spread;
			if (limit.measure === 'OVERTIME_HOURS') return row.overtime;
			return row.worked;
		};
		for (const limit of limits) {
			if (limit.measure === 'OVERTIME_HOURS' && normal == null) continue;
			const value = read(limit);
			const maximum = evaluated[limit.key] ?? limit.max_hours;
			if (!(value > maximum)) continue;
			// One sentence per limit and period: six changed days inside the same breaching week
			// state the same fact once.
			const periodIdentity = `${limit.key}:${limit.period}:${periodKey(limit.period, date)}`;
			if (reported.has(periodIdentity)) continue;
			reported.add(periodIdentity);
			breaches.push({
				key: limit.key,
				period: limit.period,
				measure: limit.measure,
				date,
				projected: value,
				maximum,
				message:
					`Roster change for ${options.subject} is refused: the plan through ${date} projects ` +
					`${value.toFixed(2)} ${MEASURE_LABEL[limit.measure]} in the ` +
					`${PERIOD_LABEL[limit.period]}, above the ${maximum}-hour limit "${limit.key}"` +
					`${limit.authority ? ` (${limit.authority})` : options.authority ? ` (${options.authority})` : ''}. ` +
					'Shorten the plan or move the work to another period.'
			});
		}
	}
	return breaches;
}
