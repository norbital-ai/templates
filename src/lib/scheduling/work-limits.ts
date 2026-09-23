/**
 * The schedule-time limit arithmetic: how planned overtime splits at the statutory limits, and the
 * roster-plan ceilings a shift or pattern is refused on.
 *
 * Every limit that bounds overtime splits it (`splitsOvertime`, owner's rule 2026-09-23: "The OT
 * entries strictly follow the statutory limits; any excess is always an incentive entry"): a day's
 * planned overtime within every such limit is stored as `approved_overtime_hours` and the excess
 * as `incentive_hours` at write time (`splitPlannedOvertime`). No overtime limit refuses a plan.
 * What still refuses is the roster plan itself — a shift whose own paid hours or spread-over are
 * above a TOTAL_WORK_HOURS or SPREAD_HOURS limit (`projectedLimitBreaches`) — because a shift's
 * hours are not overtime and cannot be moved to incentive. This module is that arithmetic, pure,
 * so the `work_days` transform, the `shift_patterns` transform and the day sheet quote the same
 * sentence.
 *
 * The projection is the pattern cycle plus the roster overlay: every date in the window resolves to
 * the roster code an explicit row names, else the code the pattern projects. A plan's paid minutes
 * are the net worked hours a limit is measured in; a CLOCK_HOURS day limit is evaluated against the
 * granted break exactly as the priced context evaluates it, so a twelve-hour clock day less a
 * one-hour break is eleven net worked hours.
 */

import {
	isRestLimit,
	type WorkHoursLimit as WorkLimit,
	type WorkLimit as AnyWorkLimit
} from '../../datatypes/work_rules/+definition.js';
import { addDays, monthBounds, weekStart } from '../../collections/payroll_runs/lib/dates.js';
import { isEligible, type PersonContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { attendanceWindow, defaultPayPeriod } from '../../collections/payroll_runs/lib/period.js';

/**
 * The limits that govern one person: every unconditional limit, and every conditional one whose
 * predicate holds over them. With no person, the unconditional limits alone — a pattern is
 * nobody's.
 */
export function applicableLimits(
	limits: readonly AnyWorkLimit[],
	person: PersonContext | null
): readonly WorkLimit[] {
	// The consecutive-work-days limit is the weekly rest rule, judged by its own gate.
	return limits
		.filter((limit): limit is WorkLimit => !isRestLimit(limit))
		.filter((limit) => {
			const when = (limit.when ?? '').trim();
			if (when === '') return true;
			return person != null && isEligible(when, person);
		});
}

/**
 * Whether a limit bounds overtime, and so splits it: a total-work or overtime limit. Not the normal
 * day or week (the threshold overtime is measured beyond), the spread-over (the shift's clock span,
 * which planned overtime does not enter) or the weekly rest rule. Planned overtime beyond it is
 * stored as `incentive_hours`.
 */
export const splitsOvertime = (limit: Pick<AnyWorkLimit, 'measure'>): boolean =>
	limit.measure === 'TOTAL_WORK_HOURS' ||
	limit.measure === 'OVERTIME_HOURS' ||
	limit.measure === 'ALL_OVERTIME_HOURS';

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
	ALL_OVERTIME_HOURS: 'overtime hours, rest days and holidays included',
	NORMAL_HOURS: 'normal hours',
	SPREAD_HOURS: 'spread-over hours'
};

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
		end: monthBounds(`${year}-${String(firstMonth + 2).padStart(2, '0')}`).end
	};
}

/**
 * The window the limits need projected around a set of changed dates: the containing period of the
 * widest limit the version declares, aligned to that period's own boundaries. A caller reads the
 * plan for exactly this window and no more.
 */
export function projectionBounds(
	dates: readonly string[],
	limits: readonly AnyWorkLimit[]
): { readonly start: string; readonly end: string } | null {
	const hours = limits.filter((limit): limit is WorkLimit => !isRestLimit(limit));
	if (dates.length === 0 || hours.length === 0) return null;
	const width = Math.max(...hours.map((limit) => PERIOD_RANK[limit.period]));
	const sorted = [...dates].toSorted();
	const first = sorted[0]!;
	const last = sorted.at(-1)!;
	if (width >= 4) return { start: `${first.slice(0, 4)}-01-01`, end: `${last.slice(0, 4)}-12-31` };
	if (width === 3) return { start: quarterBounds(first).start, end: quarterBounds(last).end };
	if (width === 2)
		return {
			start: `${first.slice(0, 7)}-01`,
			end: monthBounds(last.slice(0, 7)).end
		};
	if (width === 1) return { start: weekStart(first), end: addDays(weekStart(last), 6) };
	return { start: first, end: last };
}

/**
 * Every limit's value in net worked hours, exactly as work rules evaluate them: a CLOCK_HOURS day
 * limit subtracts the break the shift grants, every other limit states its figure directly.
 */
export function evaluatedLimits(
	limits: readonly AnyWorkLimit[],
	breakMinutes: number
): Record<string, number> {
	const evaluated: Record<string, number> = {};
	for (const limit of limits) {
		if (isRestLimit(limit)) continue;
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

/** A day's planned overtime, as stored: the hours within the limits and the excess beyond them. */
export type OvertimeSplit = {
	readonly approved_overtime_hours: number;
	readonly incentive_hours: number;
};

/** One planned day the split reads: its plan, and the total overtime the operator planned on it. */
export type OvertimeSplitDay = SchedulePlanDay & {
	/** The day's total planned overtime, in half-hour steps: approved plus incentive. */
	readonly total_overtime_hours: number;
	/** `work_days.emergency_cause`: the hours sit outside every ceiling (TW 勞基法 §32(4)). */
	readonly emergency?: boolean;
	/** The entity's calendar has a holiday on the date. */
	readonly holiday?: boolean;
};

/**
 * The assessment month a date is counted in: the pay period whose attendance window holds it
 * (`attendanceWindow`, the company's `pay_cutoff_day` — Nihon's 21st to 20th). A cutoff of 1 is
 * the calendar month.
 */
const assessmentPeriod = (date: string, cutoffDay: number): string =>
	defaultPayPeriod(date, cutoffDay);

/** The attendance window of the assessment month a date is counted in. */
export const assessmentWindow = (
	date: string,
	cutoffDay: number
): { readonly start: string; readonly end: string } =>
	attendanceWindow(assessmentPeriod(date, cutoffDay), cutoffDay);

/**
 * Split each day's total planned overtime into the hours within the limits
 * (`approved_overtime_hours`) and the excess beyond them (`incentive_hours`), the way a loan
 * recovery never exceeds its cap: the limits decide how much is overtime, the rest is incentive.
 *
 * Every limit that bounds overtime caps it (`splitsOvertime`). Days are allocated chronologically,
 * each taking the least headroom its caps leave after the days before it —
 *
 *   DAY   TOTAL_WORK_HOURS          evaluated maximum (a CLOCK_HOURS figure less the break) less
 *                                   the plan's paid hours
 *   DAY   (ALL_)OVERTIME_HOURS      the maximum
 *   WEEK… TOTAL_WORK_HOURS          the maximum less every planned hour of the period and the
 *                                   approved hours already allocated in it
 *   WEEK… (ALL_)OVERTIME_HOURS      the maximum less the approved hours already allocated in it
 *
 * — floored to the half hour where a cap binds, so both entries stay in half-hour steps. Every day
 * counts toward the week, month, quarter and year, whatever its roster code or the calendar:
 * planned overtime on a rest, off or holiday day consumes their headroom like any other (owner's
 * rule, 2026-09-23). A day limit applies as its measure states: TOTAL_WORK_HOURS and
 * ALL_OVERTIME_HOURS bound every day (MY s.60A(7), SG s.38(8), TW §32(2): the hours of work in any
 * one day); OVERTIME_HOURS is the regulated overtime of an ordinary or off day, so it leaves a REST
 * day and a holiday to the period limits (ID PP 35/2021 art.26(2) puts rest-day and holiday overtime
 * outside the four hours; VN art.107(2)(b)'s four hours are the working day's, Decree 145 art.60
 * allowing twelve on a rest day or holiday). An emergency day is outside every ceiling: all of it is
 * overtime and it consumes nothing. A MONTH is the assessment month of `cutoffDay` (default 1, the
 * calendar month); a WEEK runs Monday to Sunday; a QUARTER or YEAR is the calendar's. Returns every
 * day's split, keyed by date. Pure: the `work_days` transform (and so the import) and the day
 * sheet's preview quote the same arithmetic.
 */
export function splitPlannedOvertime(options: {
	readonly days: readonly OvertimeSplitDay[];
	readonly limits: readonly WorkLimit[];
	/** The company's `pay_cutoff_day`: the day the assessment month opens. */
	readonly cutoffDay?: number;
}): ReadonlyMap<string, OvertimeSplit> {
	const cutoffDay = options.cutoffDay ?? 1;
	const caps = options.limits.filter(splitsOvertime);
	// A holiday's work is its planned overtime: the code names the shift the person would have
	// worked, which is not worked on top of it.
	const plannedHours = (day: OvertimeSplitDay): number =>
		day.kind === 'WORK' && day.holiday !== true ? day.paid_minutes / 60 : 0;
	// Per limit and period: the hours already inside it. A period TOTAL_WORK_HOURS cap holds every
	// planned hour of the period from the start; the allocated overtime joins it day by day.
	const used = new Map<string, number>();
	const period = (limit: WorkLimit, date: string): string =>
		limit.period === 'WEEK'
			? weekStart(date)
			: limit.period === 'MONTH'
				? assessmentPeriod(date, cutoffDay)
				: limit.period === 'QUARTER'
					? quarterKey(date)
					: date.slice(0, 4);
	const bucket = (limit: WorkLimit, date: string) => `${limit.key}:${period(limit, date)}`;
	const add = (limit: WorkLimit, date: string, hours: number) =>
		used.set(bucket(limit, date), (used.get(bucket(limit, date)) ?? 0) + hours);
	const days = options.days.toSorted((left, right) => left.date.localeCompare(right.date));
	for (const day of days)
		for (const limit of caps)
			if (limit.period !== 'DAY' && limit.measure === 'TOTAL_WORK_HOURS')
				add(limit, day.date, plannedHours(day));
	const split = new Map<string, OvertimeSplit>();
	for (const day of days) {
		const total = Math.max(0, day.total_overtime_hours);
		if (day.emergency === true) {
			split.set(day.date, { approved_overtime_hours: total, incentive_hours: 0 });
			continue;
		}
		const evaluated = evaluatedLimits(caps, day.break_minutes);
		let headroom = total;
		for (const limit of caps) {
			if (
				limit.period === 'DAY' &&
				limit.measure === 'OVERTIME_HOURS' &&
				(day.kind === 'REST' || day.holiday === true)
			)
				continue;
			const maximum = evaluated[limit.key] ?? limit.max_hours;
			const left =
				limit.period === 'DAY'
					? limit.measure === 'TOTAL_WORK_HOURS'
						? maximum - plannedHours(day)
						: maximum
					: maximum - (used.get(bucket(limit, day.date)) ?? 0);
			headroom = Math.min(headroom, left);
		}
		// A cap that binds leaves half-hour steps; an unbound total stands as planned.
		const approved = headroom >= total ? total : Math.floor(Math.max(0, headroom) * 2 + 1e-9) / 2;
		for (const limit of caps) if (limit.period !== 'DAY') add(limit, day.date, approved);
		split.set(day.date, { approved_overtime_hours: approved, incentive_hours: total - approved });
	}
	return split;
}

/**
 * Every roster-plan ceiling the changed dates breach, with the sentence a refusal quotes: a shift's
 * own paid hours against a TOTAL_WORK_HOURS limit, its spread-over against a SPREAD_HOURS one.
 * Planned overtime is not read — it is split at the limits, never refused (`splitPlannedOvertime`)
 * — and neither are the overtime measures, which bound only overtime. Only periods a changed date
 * falls inside are judged: a plan edit elsewhere in the year is not this write's refusal.
 */
export function projectedLimitBreaches(options: {
	readonly subject: string;
	readonly changedDates: ReadonlySet<string>;
	readonly planByDate: ReadonlyMap<string, SchedulePlanDay>;
	readonly limits: readonly WorkLimit[];
	readonly authority?: string | null;
}): LimitBreach[] {
	const limits = options.limits.filter(
		(limit) => limit.measure === 'TOTAL_WORK_HOURS' || limit.measure === 'SPREAD_HOURS'
	);
	if (limits.length === 0 || options.changedDates.size === 0) return [];
	const hours = (plan: SchedulePlanDay | undefined): number =>
		plan != null && plan.kind === 'WORK' ? plan.paid_minutes / 60 : 0;
	const spread = (plan: SchedulePlanDay | undefined): number =>
		plan != null && plan.kind === 'WORK' ? plan.spread_hours : 0;
	type Totals = { worked: number; spread: number };
	const totals = new Map<string, Totals>();
	const add = (period: string, key: string, plan: SchedulePlanDay | undefined): void => {
		const id = `${period}:${key}`;
		const row = totals.get(id) ?? { worked: 0, spread: 0 };
		row.worked += hours(plan);
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
			if (limit.period === 'DAY')
				return limit.measure === 'SPREAD_HOURS' ? plan.spread_hours : hours(plan);
			const row = totals.get(`${limit.period}:${periodKey(limit.period, date)}`);
			if (row == null) return 0;
			return limit.measure === 'SPREAD_HOURS' ? row.spread : row.worked;
		};
		for (const limit of limits) {
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
