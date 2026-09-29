/**
 * The schedule-time limit arithmetic, pure, so the `work_days` and `shift_patterns` transforms, the
 * import and the day sheet quote one sentence. Planned overtime is two keyed figures (owner's rule,
 * 2026-09-23): `approved_overtime_hours` within every limit that bounds it, `incentive_hours`
 * beyond; a direct write is refused past the headroom (`overtimeHeadroom`), and only the import
 * splits a total (`splitPlannedOvertime`). A shift whose own hours or spread-over pass a
 * TOTAL_WORK_HOURS or SPREAD_HOURS limit is refused (`projectedLimitBreaches`). The projection is
 * the pattern cycle plus the roster overlay, measured in net worked minutes.
 */

import {
	isRestLimit,
	type WorkHoursLimit as WorkLimit,
	type WorkLimit as AnyWorkLimit
} from '../datatypes/work_rules.js';
import { addDays, monthBounds, weekStart } from '../../lib/payroll/run/dates.js';
import {
	isEligible,
	personContext,
	type PersonContext,
	type PersonInput
} from '../../lib/payroll/run/eligibility.js';
import { attendanceWindow, defaultPayPeriod } from '../../lib/payroll/run/period.js';
import { resolveSchedule, type ScheduledDay } from '../../lib/payroll/run/schedule.js';
import type { ShiftDefinition } from '../../lib/payroll/run/configuration.js';
import type { WorkRules } from '../datatypes/work_rules.js';
import { resolveHolidays, type HolidayRow } from '../holiday-calendar.js';
import type { ShiftPatternLike } from './work-pattern.js';
import { rosterCodeKind, workWindow } from './roster-code.js';
import type { RosterCodeVariant } from '../datatypes/roster_code_variant.js';
import { workDayHolds } from '../payroll/work-bands.js';
import {
	classifyWageComparand,
	deriveStatutoryWages
} from '../../lib/payroll/run/statutory-wages.js';
import { decodeNumber } from '../wire.js';

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
	/** A REST code marked the statutory rest day (TW 例假), for a limit's day predicates. */
	readonly statutory_rest?: boolean | undefined;
};

/** The roster-code facts a plan resolves to; `work_days` and `shift_patterns` both carry them. */
export type RosterCodeFacts = {
	readonly kind: SchedulePlanKind;
	readonly paid_minutes: number;
	readonly break_minutes: number;
	readonly spread_hours: number;
	readonly statutory_rest?: boolean | undefined;
};

/** A roster code's facts, as the projection reads them; null where a WORK code states no window. */
export function rosterCodeFacts(variant: RosterCodeVariant): RosterCodeFacts | null {
	const kind = rosterCodeKind(variant);
	if (kind !== 'WORK')
		return {
			kind,
			paid_minutes: 0,
			break_minutes: 0,
			spread_hours: 0,
			statutory_rest: variant.kind === 'REST' && variant.statutory === true
		};
	const window = workWindow(variant);
	return window == null
		? null
		: {
				kind,
				paid_minutes: window.paid_minutes,
				break_minutes: window.break_minutes,
				spread_hours: window.elapsed_minutes / 60
			};
}

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
			spread_hours: 0,
			...(facts?.statutory_rest === true && { statutory_rest: true })
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
type OvertimeSplitDay = SchedulePlanDay & {
	/** The day's total planned overtime, in half-hour steps: approved plus incentive. */
	readonly total_overtime_hours: number;
	/** A stored day the split does not re-split: the approved hours it keeps, counted as they stand. */
	readonly fixed_overtime_hours?: number | undefined;
	/** `work_days.emergency_cause`: the hours sit outside every ceiling (TW 勞基法 §32(4)). */
	readonly emergency?: boolean | undefined;
	/** The person observes a company holiday on the date (`observedDays`). */
	readonly holiday?: boolean | undefined;
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
 * The overtime caps of a limit set, as the split and the headroom read them:
 *
 *   DAY   TOTAL_WORK_HOURS          the maximum (a CLOCK_HOURS figure less the break) less the plan
 *   DAY   (ALL_)OVERTIME_HOURS      the maximum
 *   WEEK… TOTAL_WORK_HOURS          the maximum less the period's planned and approved hours
 *   WEEK… (ALL_)OVERTIME_HOURS      the maximum less the period's approved hours
 *
 * TOTAL_WORK_HOURS and ALL_OVERTIME_HOURS count every day (MY s.60A(7), SG s.38(8), TW §32(2));
 * OVERTIME_HOURS skips rest days and holidays (ID PP 35/2021 art.26(2), VN art.107(2)(b)) unless
 * `counts_day_when` holds (all of the day's overtime) or `counts_beyond_normal_when` (past the
 * normal hours: TW 勞基法 §36(3)). A MONTH is the `cutoffDay` month, a WEEK Monday–Sunday.
 */
function overtimeCaps(limits: readonly WorkLimit[], cutoffDay: number) {
	const caps = limits.filter(splitsOvertime);
	// A holiday's work is its planned overtime: the code names the shift the person would have
	// worked, which is not worked on top of it.
	const plannedHours = (day: OvertimeDay): number =>
		day.kind === 'WORK' && day.holiday !== true ? day.paid_minutes / 60 : 0;
	// The day as the ceiling report's predicates read it. A holiday on a rest day stays the rest
	// day, as every lineage with a limit resolves it (`holiday_rest_precedence` REST_DAY or
	// SUBSTITUTE). ponytail: no person here — a day predicate reading `person` sees a blank one;
	// pass the person through when a lineage's predicate needs it.
	const holds = (expression: string | null | undefined, day: OvertimeDay): boolean =>
		(expression ?? '').trim() !== '' &&
		workDayHolds({
			work: { limits },
			expression: expression ?? '',
			person: personContext({
				employee: null,
				employment: { service_start: '' },
				terms: null,
				company: null,
				asOf: day.date
			}),
			day: {
				workDayId: '',
				date: day.date,
				dayType:
					day.kind === 'REST'
						? 'REST_DAY'
						: day.holiday === true
							? 'PUBLIC_HOLIDAY'
							: day.kind === 'WORK'
								? 'ORDINARY'
								: 'OFF_DAY',
				workedHours: plannedHours(day) + day.overtime,
				normalHours: day.paid_minutes / 60,
				overtimeHours: day.overtime,
				breakMinutes: day.break_minutes,
				holidayKind: day.holiday === true ? 'PUBLIC_HOLIDAY' : '',
				holidayName: '',
				consecutiveHours: 0,
				continuousAttendance: false,
				restDay: day.kind === 'REST',
				statutoryRest: day.statutory_rest === true,
				offDay: day.kind !== 'WORK' && day.kind !== 'REST',
				nightHours: 0,
				requestedBy: 'EMPLOYER'
			},
			rates: { ordinaryHour: 0, dayWage: 0 }
		});
	// The day's planned overtime a limit does not count: none on a day it counts whole, the normal
	// hours where it counts only beyond them, and all of it (Infinity) on a day outside it.
	const uncounted = (limit: WorkLimit, day: OvertimeDay): number => {
		if (limit.measure !== 'OVERTIME_HOURS') return 0;
		if (day.kind !== 'REST' && day.holiday !== true) return 0;
		if (holds(limit.counts_day_when, day)) return 0;
		// The normal day is the shift the code names; a rest day names none.
		if (holds(limit.counts_beyond_normal_when, day)) return day.paid_minutes / 60;
		return Number.POSITIVE_INFINITY;
	};
	/** What a DAY cap leaves the day's overtime. */
	const dayLeft = (limit: WorkLimit, day: OvertimeDay): number => {
		const maximum = evaluatedLimits([limit], day.break_minutes)[limit.key] ?? limit.max_hours;
		return limit.measure === 'TOTAL_WORK_HOURS' ? maximum - plannedHours(day) : maximum;
	};
	const period = (limit: WorkLimit, date: string): string =>
		limit.period === 'WEEK'
			? weekStart(date)
			: limit.period === 'MONTH'
				? assessmentPeriod(date, cutoffDay)
				: limit.period === 'QUARTER'
					? quarterKey(date)
					: date.slice(0, 4);
	const bucket = (limit: WorkLimit, date: string) => `${limit.key}:${period(limit, date)}`;
	return { caps, plannedHours, uncounted, dayLeft, bucket };
}

/** One day the caps read: its plan, and the overtime the arithmetic weighs on it. */
type OvertimeDay = SchedulePlanDay & {
	readonly overtime: number;
	readonly emergency?: boolean | undefined;
	readonly holiday?: boolean | undefined;
};

const floorHalf = (hours: number): number => Math.floor(Math.max(0, hours) * 2 + 1e-9) / 2;

/**
 * Split each day's total planned overtime into the hours within the limits
 * (`approved_overtime_hours`) and the excess beyond them (`incentive_hours`), the way a loan
 * recovery never exceeds its cap: the limits decide how much is overtime, the rest is incentive.
 *
 * This is the import's arithmetic (and the seed preparation's), never a direct write's: an operator
 * keys the two figures apart, within `overtimeHeadroom`. A day carrying `fixed_overtime_hours` is a
 * stored day the file does not restate: its approved hours are counted in their periods as they
 * stand, and it is returned unchanged. The other days are allocated chronologically, each taking
 * the least headroom its caps (`overtimeCaps`) leave after the fixed days and the days before it,
 * floored to the half hour where a cap binds, so both entries stay in half-hour steps. An emergency
 * day is outside every ceiling: all of it is overtime and it consumes nothing. Returns every day's
 * split, keyed by date.
 */
export function splitPlannedOvertime(options: {
	readonly days: readonly OvertimeSplitDay[];
	readonly limits: readonly WorkLimit[];
	/** The company's `pay_cutoff_day`: the day the assessment month opens. */
	readonly cutoffDay?: number | undefined;
}): ReadonlyMap<string, OvertimeSplit> {
	const { caps, plannedHours, uncounted, dayLeft, bucket } = overtimeCaps(
		options.limits,
		options.cutoffDay ?? 1
	);
	const read = (day: OvertimeSplitDay): OvertimeDay => ({
		...day,
		overtime: day.fixed_overtime_hours ?? day.total_overtime_hours
	});
	// Per limit and period: the hours already inside it. A period TOTAL_WORK_HOURS cap holds every
	// planned hour of the period from the start, and a fixed day's approved hours hold their place.
	const used = new Map<string, number>();
	const add = (limit: WorkLimit, date: string, hours: number) =>
		used.set(bucket(limit, date), (used.get(bucket(limit, date)) ?? 0) + hours);
	const days = options.days.toSorted((left, right) => left.date.localeCompare(right.date));
	for (const day of days)
		for (const limit of caps) {
			if (limit.period === 'DAY') continue;
			if (limit.measure === 'TOTAL_WORK_HOURS') add(limit, day.date, plannedHours(read(day)));
			if (day.fixed_overtime_hours != null && day.emergency !== true)
				add(limit, day.date, Math.max(0, day.fixed_overtime_hours - uncounted(limit, read(day))));
		}
	const split = new Map<string, OvertimeSplit>();
	for (const day of days) {
		const total = Math.max(0, day.total_overtime_hours);
		if (day.fixed_overtime_hours != null) {
			split.set(day.date, {
				approved_overtime_hours: day.fixed_overtime_hours,
				incentive_hours: Math.max(0, total - day.fixed_overtime_hours)
			});
			continue;
		}
		if (day.emergency === true) {
			split.set(day.date, { approved_overtime_hours: total, incentive_hours: 0 });
			continue;
		}
		const weighed = read(day);
		const free = new Map(caps.map((limit) => [limit, uncounted(limit, weighed)]));
		let headroom = total;
		for (const limit of caps) {
			const left =
				limit.period === 'DAY'
					? dayLeft(limit, weighed)
					: limit.max_hours - (used.get(bucket(limit, day.date)) ?? 0);
			headroom = Math.min(headroom, free.get(limit)! + left);
		}
		// A cap that binds leaves half-hour steps; an unbound total stands as planned.
		const approved = headroom >= total ? total : floorHalf(headroom);
		for (const limit of caps)
			if (limit.period !== 'DAY') add(limit, day.date, Math.max(0, approved - free.get(limit)!));
		split.set(day.date, { approved_overtime_hours: approved, incentive_hours: total - approved });
	}
	return split;
}

/** One stored or drafted day the headroom reads: its plan and the approved overtime it holds. */
type HeadroomDay = SchedulePlanDay & {
	readonly approved_overtime_hours: number;
	/** `work_days.emergency_cause`: the hours sit outside every ceiling (TW 勞基法 §32(4)). */
	readonly emergency?: boolean | undefined;
	/** The person observes a company holiday on the date (`observedDays`). */
	readonly holiday?: boolean | undefined;
};

/** The most approved overtime a day can hold, and the limit that binds it. */
export type OvertimeMaximum = { readonly hours: number; readonly limit: WorkLimit };

/** A day whose approved overtime is above what its caps leave it. */
type OvertimeBreach = {
	readonly date: string;
	readonly approved: number;
	/** The most approved overtime the day can hold, given the days before it. */
	readonly maximum: number;
	readonly limit: WorkLimit;
};

/**
 * The statutory headroom of a window of days, by the counting `splitPlannedOvertime` uses
 * (`overtimeCaps`).
 *
 * `maximum` is, per date, the most approved overtime the day can hold with every other day of the
 * window at its stored approved hours: the least room its caps leave, floored to the half hour, and
 * the limit that binds. Null is a day no cap bounds (no overtime limit, or an emergency day).
 *
 * `breaches` are the days over their headroom, read in date order: a period cap's first day whose
 * running total passes the maximum is the day named, so an edit to an earlier day that leaves a
 * later stored day over its limit names that later day. The two readings agree: a window with no
 * breach is one where every day is within its `maximum`.
 */
export function overtimeHeadroom(options: {
	readonly days: readonly HeadroomDay[];
	readonly limits: readonly WorkLimit[];
	readonly cutoffDay?: number | undefined;
}): {
	readonly maximum: ReadonlyMap<string, OvertimeMaximum | null>;
	readonly breaches: readonly OvertimeBreach[];
} {
	const { caps, plannedHours, uncounted, dayLeft, bucket } = overtimeCaps(
		options.limits,
		options.cutoffDay ?? 1
	);
	const days = options.days
		.map((day): OvertimeDay => ({ ...day, overtime: day.approved_overtime_hours }))
		.toSorted((left, right) => left.date.localeCompare(right.date));
	const counted = (limit: WorkLimit, day: OvertimeDay): number =>
		day.emergency === true ? 0 : Math.max(0, day.overtime - uncounted(limit, day));
	// Every period's whole total, for the all-other-days reading.
	const total = new Map<string, number>();
	const add = (into: Map<string, number>, limit: WorkLimit, date: string, hours: number) =>
		into.set(bucket(limit, date), (into.get(bucket(limit, date)) ?? 0) + hours);
	const planned = new Map<string, number>();
	for (const day of days)
		for (const limit of caps) {
			if (limit.period === 'DAY') continue;
			if (limit.measure === 'TOTAL_WORK_HOURS') add(planned, limit, day.date, plannedHours(day));
			add(total, limit, day.date, counted(limit, day));
		}
	const maximum = new Map<string, OvertimeMaximum | null>();
	const breaches: OvertimeBreach[] = [];
	const running = new Map<string, number>();
	for (const day of days) {
		// The room each cap leaves: with every other day (`others`), and with the days before it.
		let least: { others: number; before: number; limit: WorkLimit } | null = null;
		let breach: { room: number; limit: WorkLimit } | null = null;
		if (day.emergency !== true)
			for (const limit of caps) {
				const free = uncounted(limit, day);
				const key = bucket(limit, day.date);
				const others =
					limit.period === 'DAY'
						? free + dayLeft(limit, day)
						: free +
							limit.max_hours -
							(planned.get(key) ?? 0) -
							((total.get(key) ?? 0) - counted(limit, day));
				const before =
					limit.period === 'DAY'
						? others
						: free + limit.max_hours - (planned.get(key) ?? 0) - (running.get(key) ?? 0);
				if (least == null || others < least.others) least = { others, before, limit };
				// A day with no approved overtime breaches no overtime cap: a shift longer than the
				// day's limit is the roster refusal's (`projectedLimitBreaches`), not this one.
				if (
					day.overtime > 1e-9 &&
					day.overtime > before + 1e-9 &&
					(breach == null || before < breach.room)
				)
					breach = { room: before, limit };
			}
		maximum.set(
			day.date,
			least == null || least.others === Number.POSITIVE_INFINITY
				? null
				: { hours: floorHalf(least.others), limit: least.limit }
		);
		if (breach != null)
			breaches.push({
				date: day.date,
				approved: day.overtime,
				maximum: floorHalf(breach.room),
				limit: breach.limit
			});
		for (const limit of caps)
			if (limit.period !== 'DAY') add(running, limit, day.date, counted(limit, day));
	}
	return { maximum, breaches };
}

/** The sentence a refusal quotes for one breach: the day, the limit, and the most it may hold. */
export function breachSentence(breach: OvertimeBreach): string {
	return (
		`${breach.date} would hold ${breach.approved} h of approved overtime, above the ` +
		`${breach.maximum} h left within the ${breach.limit.max_hours}-hour limit "${breach.limit.key}" ` +
		`(${MEASURE_LABEL[breach.limit.measure]} in the ${PERIOD_LABEL[breach.limit.period]})`
	);
}

/** What a person's schedule resolves the dates to, read the way payroll prices them. */
export type ObservedDays = {
	/** The dates the person observes a company holiday on. */
	readonly holidays: ReadonlySet<string>;
	/**
	 * The dates payroll resolves as an off day: under `last_rest_day_only` (MY s.59(1)) a REST code
	 * with a later REST code in its Monday–Sunday week is not the week's rest day.
	 */
	readonly offDays: ReadonlySet<string>;
};

/**
 * The days a person observes, exactly as payroll prices them: payroll's own `resolveSchedule` over
 * each assessment window (the attendance window a run resolves), with the published rows of the
 * company's calendar — replacement days included, a local day only at the worksite the person's
 * terms record on it (PH RA 12271, as `atWorksite`) — the rosters of record, the version's
 * `holiday_rest_precedence` (under SUBSTITUTE a holiday on the rest day is carried to the next
 * working day, unless the calendar publishes its replacement), its `last_rest_day_only` and each
 * row's `given_to`. The split, the headroom, the day sheet and the import read this (through
 * `observedPlan`), so none keeps a calendar rule of its own. Throws where the schedule cannot be
 * resolved, as a run would.
 */
export function observedDays(options: Parameters<typeof resolvedDays>[0]): ObservedDays {
	const holidays = new Set<string>();
	const offDays = new Set<string>();
	for (const day of resolvedDays(options).values()) {
		if (day.observedHoliday != null) holidays.add(day.date);
		if (day.offDay) offDays.add(day.date);
	}
	return { holidays, offDays };
}

/** A plan day as payroll resolves it: its observed holiday, and a REST code resolved as an off day. */
export function observedPlan<Plan extends SchedulePlanDay>(
	plan: Plan,
	observed: ObservedDays
): Plan & { readonly holiday: boolean } {
	return {
		...plan,
		...(plan.kind === 'REST' && observed.offDays.has(plan.date) && { kind: 'OFF' as const }),
		holiday: observed.holidays.has(plan.date)
	};
}

/**
 * The holidays a person observes, by date, with the name each is observed under and — for a
 * rest-day holiday SUBSTITUTE carried to a working day — the date it fell on. Read exactly as
 * payroll resolves them (`resolveSchedule`); see `observedDays`. The month board draws a
 * person's cells from this, so a board and a payslip cannot name different holidays.
 */
export function observedHolidays(
	options: Parameters<typeof resolvedDays>[0]
): ReadonlyMap<string, { readonly name: string; readonly from: string | null }> {
	const observed = new Map<string, { readonly name: string; readonly from: string | null }>();
	for (const day of resolvedDays(options).values())
		if (day.observedHoliday != null) observed.set(day.date, day.observedHoliday);
	return observed;
}

function resolvedDays(options: {
	readonly dates: readonly string[];
	readonly cutoffDay: number;
	readonly companyId: string;
	readonly holidays: readonly HolidayRow[];
	readonly codes: readonly Pick<ShiftDefinition, 'id' | 'code' | 'variant' | 'effective_range'>[];
	/** The version's work rules in force; none resolves nothing. */
	readonly work:
		Pick<WorkRules, 'holiday_rest_precedence' | 'last_rest_day_only'> | null | undefined;
	/** The person's stored plans: the explicit roster code of each dated row. */
	readonly plans: readonly {
		readonly work_date: string;
		readonly shift_definition_id: string | null;
	}[];
	/** The months (YYYY-MM) the person has a roster of record for. */
	readonly rosterPeriods: readonly string[];
	/** The pattern in force on a date, and the day its cycle counts from. */
	readonly patternOn: (
		date: string
	) => { readonly pattern: ShiftPatternLike['pattern']; readonly anchor: string | null } | null;
	/** The worksite the person's terms record on a date: a local day reaches only that site's staff. */
	readonly worksiteOn: (date: string) => string | null | undefined;
}): ReadonlyMap<string, ScheduledDay> {
	const resolved = new Map<string, ScheduledDay>();
	const precedence = options.work?.holiday_rest_precedence;
	if (precedence == null) return resolved;
	const shiftById = new Map(options.codes.map((code) => [code.id, code as ShiftDefinition]));
	const windows = new Map(
		options.dates.map((date) => {
			const window = assessmentWindow(date, options.cutoffDay);
			return [window.start, window] as const;
		})
	);
	for (const window of windows.values()) {
		const dates: string[] = [];
		for (let date = window.start; date <= window.end; date = addDays(date, 1)) dates.push(date);
		const schedule = resolveSchedule({
			window,
			dates,
			terms: (date) => {
				const row = options.patternOn(date);
				// The day type reads no hours: the normal day is the priced day's figure, not this one's.
				return {
					work_pattern: row?.pattern ?? null,
					pattern_anchor: row?.anchor ?? null,
					normal_daily_hours: 0
				};
			},
			workDays: options.plans,
			rosters: options.rosterPeriods.map((period) => monthBounds(period)),
			configuration: {
				holidays: resolveHolidays(
					options.holidays,
					options.companyId,
					window.start,
					window.end,
					options.worksiteOn
				),
				shiftById,
				holidayRestPrecedence: precedence,
				lastRestDayOnly: options.work?.last_rest_day_only === true
			}
		});
		for (const day of schedule.values()) resolved.set(day.date, day);
	}
	return resolved;
}

/** An allowance class as the wage comparand reads it: where it pays and which way. */
type AllowanceClass = {
	readonly destination: string | null;
	readonly direction: string | null;
	readonly counts_toward?: readonly string[] | null;
};

/**
 * Whether the version's overtime rule (`work.overtime_when`) covers a person, read before a run.
 * The wage it compares is the one payroll derives (`deriveStatutoryWages`): the contract's basic
 * salary plus every allowance the contract lists whose class is marked for the applicable wage
 * comparand (`classifyWageComparand`), each at its contractual monthly amount. `allowanceClass` resolves a
 * listed allowance's catalogue row; one it cannot resolve counts nothing, as payroll counts a class
 * the period's version no longer offers. Ad hoc payments and claims are the run's own and are not
 * known before it: a person carried past a wage ceiling by them alone is named by the run's warning.
 */
export function overtimeEntitled(
	overtimeWhen: string | null | undefined,
	person: PersonInput,
	allowanceClass: (catalogueId: string) => AllowanceClass | undefined = () => undefined
): boolean {
	const when = (overtimeWhen ?? '').trim();
	if (when === '') return true;
	const { terms } = person;
	const wages = deriveStatutoryWages({
		baseSalary: { value: (terms?.base_salary ?? 0) || 0, currency: terms?.currency ?? '' },
		payments: (terms?.allowances ?? []).flatMap((row) => {
			const row_class = allowanceClass(row.catalogue_id);
			return row_class == null
				? []
				: [
						{
							category: classifyWageComparand({ ...row_class, definition: { source: 'ENTRY' } }),
							amount: row.amount
						}
					];
		})
	});
	return isEligible(when, personContext({ ...person, statutoryWages: wages.value }));
}

/**
 * Every roster-plan ceiling the changed dates breach, with the sentence a refusal quotes: a shift's
 * own paid hours against a TOTAL_WORK_HOURS limit, its spread-over against a SPREAD_HOURS one.
 * Planned overtime is not read — it is judged by `overtimeHeadroom` — and neither are the
 * overtime measures, which bound only overtime. Only periods a changed date
 * falls inside are judged: a plan edit elsewhere in the year is not this write's refusal.
 */
export function projectedLimitBreaches(options: {
	readonly subject: string;
	readonly changedDates: ReadonlySet<string>;
	readonly planByDate: ReadonlyMap<string, SchedulePlanDay>;
	readonly limits: readonly WorkLimit[];
	readonly authority?: string | null | undefined;
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
