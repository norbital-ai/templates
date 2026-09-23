/**
 * Planned hours become money; the clock only confirms the day was worked.
 *
 * Overtime is **preplanned, never derived** (owner's rule, 2026-09-23): a work day carries two
 * entries, `approved_overtime_hours` — the planned overtime within the statutory limits — and
 * `incentive_hours` — the planned excess beyond them. The two are keyed on the day — split only by
 * the import (`splitPlannedOvertime`), bounded by the `work_days` transform's headroom check
 * (`overtimeHeadroom`); payroll funnels nothing. It
 * prices the approved hours on the day type's OVERTIME band and the incentive hours on that
 * band's INCENTIVE line, and nothing else beyond the shift.
 *
 * Attendance only confirms presence: a day with no worked interval, or none that holds an hour
 * after the shift start, pays neither entry. Clock time beyond the plan never pays. A REST, OFF or
 * holiday day is the same: only its planned entries pay, so rest-day or holiday work the roster
 * wants paid is planned as that day's overtime. The clock-derived premium up to the normal day
 * that non-ordinary days used to earn is gone, and with it the workbook divergence it documented.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * REST-DAY AND PUBLIC-HOLIDAY WORK IS PRICED BY STATUTE, FROM THE SEEDED RULES.
 *
 * The planned hours run through the version's bands: on a rest day or holiday the first hours up
 * to the normal day pay the highest `FROM_START_OF_DAY` band entered and only hours beyond it run
 * through the `BEYOND_NORMAL` ladder (EA s.60(3), s.60D(3), and each jurisdiction's own members).
 * There is no switch. The ladder is data: change the effective-dated regime, not this file.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * THE STATUTORY REST BREAK IS ASSESSED FROM THE PUNCHES AND REPORTED.
 *
 * `work_rules.breaks` is a consecutive-hours rule transcribed from primary text; overtime is not
 * its trigger, which is why the same rule catches a ten-hour split shift that earned no overtime.
 * `counts_as_worked_time` records whether the statute calls the break working time (false: ID
 * UU 13/2003 ps.79(2)(a); null: silent, MY s.60A(1)(a)).
 *
 * Planned hours are inclusive of breaks by the scheduler's own definition, so the shortfall is
 * assessed and reported (`restBreak`) and deducts nothing from them — deducting it would charge
 * the break twice, once inside the number that was planned and once here.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

import type { NightPremium } from '../../../lib/payroll/work-rules-values.js';
import type { PersonContext } from './eligibility.js';
import {
	restBreakAssessment,
	type BreakRuleLike,
	type RestBreakAssessment
} from '../../../lib/scheduling/rest-break.js';
import { requiredDateKey, type IsoDate } from './dates.js';
import { type DayType, type ScheduledDay } from './schedule.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { clockMinutes } from '../../../lib/scheduling/roster-code.js';

/**
 * The wall-clock frame attendance is recorded in, in minutes east of UTC.
 *
 * A shift start is a wall-clock time and a punch is an instant, so pairing them needs an offset.
 * Nothing in the schema carries one today — neither `companies` nor `jurisdiction_settings` has a timezone
 * column — so it is stated here, as the pre-refactor engine also did (`ATTENDANCE_TZ_OFFSET`).
 *
 * **This must match the frame the attendance clocks are stored in.** The seed writes them as
 * `+08:00` instants (`2025-12-31T08:17:00.000+08:00`), and both populations — Malaysia and the
 * Philippines — are fixed UTC+8 with no daylight saving, so a single constant is exact for them.
 * Left at 0 it would anchor each work date to UTC midnight and throw the early-clock-in clamp and
 * the shift-end comparison out by eight hours, silently mispricing every overtime hour.
 *
 * This constant is only the default for callers that pass no offset; the engine derives the real
 * one from `configuration.jurisdiction.timezone` with `offsetMinutesFor`, so a third jurisdiction
 * off UTC+8 is a settings row, not an edit here.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * THE TIMEZONE IS THE JURISDICTION VERSION'S IANA ZONE.
 *
 * `jurisdiction_settings.timezone` (an IANA name such as `Asia/Jakarta`) is the fact, exactly as
 * `currency` and `tax_year_start_month` are; the engine derives the offset for the date it prices
 * (`offsetMinutesFor`), so a zone that observes daylight saving needs no second column and no
 * change here. Attendance is stored and compared as instants, so no reader depends on the writer's
 * frame.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
const ATTENDANCE_UTC_OFFSET_MINUTES = 8 * 60;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export type WorkDayLike = {
	readonly id: string;
	readonly work_date: string;
	readonly worked_intervals: ReadonlyArray<{
		readonly start: string;
		readonly end: string | null;
	}> | null;
	/** The day's break, derived by the caller (`derivedBreakMinutes`); absent reads as none. */
	readonly break_minutes?: number | undefined;
	/** The planned overtime within the limits, breaks included; absent reads as none. */
	readonly approved_overtime_hours?: number | null | undefined;
	/** The planned overtime beyond the limits, breaks included; absent reads as none. */
	readonly incentive_hours?: number | null | undefined;
};

function instant(value: string): number {
	return Date.parse(value);
}

type Interval = {
	readonly start: number;
	readonly end: number;
};

/**
 * Parse and union the observed intervals. Overlap is refused by the work day transform, but unioning here
 * makes payroll safe against historical/imported duplicates: the same minute can never be paid
 * twice. A missing end is the sole representation of an open clock and blocks the run.
 */
export function normalizedWorkedIntervals(entry: WorkDayLike): readonly Interval[] {
	const workDate = requiredDateKey(entry.work_date, 'work_days.work_date');
	if (entry.worked_intervals == null)
		throw new Error(`Work day ${entry.id} on ${workDate} recorded no attendance at all.`);
	const parsed = entry.worked_intervals
		.map((interval) => {
			// The record, not only the day. Dozens of people clock on any given date, so a refusal that
			// named the date alone told whoever had to fix it which day to search and nothing more.
			if (interval.end == null)
				throw new Error(`Work day ${entry.id} on ${workDate} is still open.`);
			const start = instant(interval.start);
			const end = instant(interval.end);
			if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
				throw new Error(
					`Work day ${entry.id} on ${workDate} contains an invalid worked interval ` +
						`(${String(interval.start)} → ${String(interval.end)}).`
				);
			return { start, end };
		})
		.toSorted((left, right) => left.start - right.start || left.end - right.end);
	const union: { start: number; end: number }[] = [];
	for (const interval of parsed) {
		const previous = union.at(-1);
		if (previous == null || interval.start > previous.end) union.push({ ...interval });
		else previous.end = Math.max(previous.end, interval.end);
	}
	return union;
}

/** Midnight starting `date`, in the frame attendance is recorded in. */
function midnight(date: IsoDate, utcOffsetMinutes: number): number {
	return Date.parse(`${date}T00:00:00.000Z`) - utcOffsetMinutes * MINUTE_MS;
}

/**
 * Hours actually worked on a day, from the clocks.
 *
 * On a scheduled day `from` is the shift start: time clocked before it is discarded, because an
 * employee who arrives early is not working, and not paid, until their shift begins. The unpaid
 * break is deducted from what remains, never below zero — the break is a derived duration, not a
 * window, so an overlap test is not available here.
 */
function clockedWorkHours(entry: WorkDayLike, from: number = Number.NEGATIVE_INFINITY): number {
	const elapsed = overlapHours(normalizedWorkedIntervals(entry), from, Number.POSITIVE_INFINITY);
	return Math.max(0, elapsed - Math.max(0, decodeNumber(entry.break_minutes ?? 0)) / 60);
}

/** The hours of the intervals inside `[start, end)`. */
function overlapHours(intervals: readonly Interval[], start: number, end: number): number {
	return intervals.reduce(
		(total, interval) =>
			total + Math.max(0, Math.min(interval.end, end) - Math.max(interval.start, start)) / HOUR_MS,
		0
	);
}

/** Actual ordinary units stay inside the shift; its outside hours are priced as overtime. */
export function ordinaryWorkedHours(
	entry: WorkDayLike,
	shift: NonNullable<ScheduledDay['shift']>,
	utcOffsetMinutes: number = ATTENDANCE_UTC_OFFSET_MINUTES
): number {
	const workDate = requiredDateKey(entry.work_date, 'work_days.work_date');
	const start = clockMinutes(shift.start_time);
	let end = clockMinutes(shift.end_time);
	if (shift.crosses_midnight || end <= start) end += 1440;
	const inside = overlapHours(
		normalizedWorkedIntervals(entry),
		midnight(workDate, utcOffsetMinutes) + start * MINUTE_MS,
		midnight(workDate, utcOffsetMinutes) + end * MINUTE_MS
	);
	return Math.min(
		shift.paid_minutes / 60,
		Math.max(0, inside - Math.max(0, decodeNumber(entry.break_minutes ?? 0)) / 60)
	);
}

/**
 * Hours inside the regime's night window, split into the shift's own hours and the rest.
 *
 * Attendance is already assigned to a work date, so the window opens at `from` on that date and,
 * when it ends at or before it opens, closes the next morning — which also catches an overtime
 * punch continuing past a scheduled night shift. Hours inside the scheduled window are ordinary;
 * everything else in the night is overtime, and on a day with no shift every night hour is.
 * The overlap is derived from the actual clock rather than a payroll workbook amount.
 */
export function nightWindowHours(
	entry: WorkDayLike,
	window: Pick<NightPremium, 'from' | 'to'>,
	shift: ScheduledDay['shift'],
	utcOffsetMinutes: number = ATTENDANCE_UTC_OFFSET_MINUTES,
	/**
	 * On a day with no shift (a rest day, a holiday) the first this many worked hours are the
	 * ordinary night hours and the rest overtime — the split the bands price the day on (PH
	 * art.93: 130% for eight hours, 169% beyond, the night add on each at 10%).
	 */
	normalHours = 0
): { readonly ordinary: number; readonly overtime: number } {
	const workDate = requiredDateKey(entry.work_date, 'work_days.work_date');
	const from = clockMinutes(window.from);
	let to = clockMinutes(window.to);
	if (to <= from) to += 1440;
	const nightStart = midnight(workDate, utcOffsetMinutes) + from * MINUTE_MS;
	const nightEnd = midnight(workDate, utcOffsetMinutes) + to * MINUTE_MS;
	const intervals = normalizedWorkedIntervals(entry);
	const night = overlapHours(intervals, nightStart, nightEnd);
	if (shift == null) {
		if (!(normalHours > 0)) return { ordinary: 0, overtime: night };
		// The first `normalHours` of the clock, in order, cut where the allowance runs out.
		let left = normalHours * HOUR_MS;
		const first: Interval[] = [];
		for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
			if (left <= 0) break;
			const take = Math.min(left, interval.end - interval.start);
			first.push({ start: interval.start, end: interval.start + take });
			left -= take;
		}
		const ordinary = overlapHours(first, nightStart, nightEnd);
		return { ordinary, overtime: night - ordinary };
	}
	const start = clockMinutes(shift.start_time);
	let end = clockMinutes(shift.end_time);
	if (shift.crosses_midnight || end <= start) end += 1440;
	// ponytail: the recorded break is not apportioned to the night; add a break window if a statute
	// prices the break itself.
	const ordinary = overlapHours(
		intervals,
		Math.max(nightStart, midnight(workDate, utcOffsetMinutes) + start * MINUTE_MS),
		Math.min(nightEnd, midnight(workDate, utcOffsetMinutes) + end * MINUTE_MS)
	);
	return { ordinary, overtime: night - ordinary };
}

/** One day's overtime, before it is priced. */
export type DailyOvertime = {
	readonly date: IsoDate;
	readonly workDayId: string;
	readonly dayType: DayType;
	/**
	 * The payable quantity: the planned approved plus incentive hours. Never negative, never
	 * zero — a zero day is dropped.
	 */
	readonly hours: number;
	/** The part of `hours` planned beyond the limits: priced on the INCENTIVE line. */
	readonly incentiveHours: number;
	/** Contracted hours for the day, the boundary `STATUTORY_DAY_WAGE` bands against. */
	readonly normalHours: number;
	/** Actual hours at the employer's disposal, used only to locate the total-work-hours boundary. */
	readonly totalWorkHours: number;
	/**
	 * The break the day recorded. A CLOCK_HOURS total-work limit is a span the shift was expected
	 * to hold: its evaluated ceiling is `max_hours - breakMinutes/60`, which is the same arithmetic
	 * the priced work-day context evaluates the limit with.
	 */
	readonly breakMinutes: number;
	/**
	 * The statutory rest break assessed for this day, or null where the jurisdiction declares no rule
	 * that governs it. Carried whatever `counts_as_worked_time` says, because a compliance shortfall
	 * is worth reporting on a day that deducted nothing — that is the Malaysian case, and it is the
	 * whole reason this member was restored.
	 */
	readonly restBreak: RestBreakAssessment | null;
};

/**
 * Read one day's payable overtime from its planned entries, confirmed by the observed day.
 *
 * Returns `null` when the day earns nothing, which is the common case: the gates fire, no
 * attendance was recorded, or nothing was planned. A day that earns nothing produces no entry at
 * all rather than a zero one, so provenance never claims a payslip line consumed a record it did
 * not.
 *
 * `restBreakRules` is the jurisdiction's transcribed rest-break member, optional in the signature so
 * that a caller which has none — and every caller had none before the member was restored — computes
 * exactly what it computed before. Omitted, null and empty are one statement: no rule governs, so
 * nothing is assessed and nothing is deducted.
 */
/**
 * The day's total worked hours, net of the recorded break. An early clock-in is not work on any
 * day that carries a shift: the total is measured from the shift start (owner's rule, 2026-09-16),
 * on a rostered rest day or holiday as on an ordinary one.
 */
export function dailyWorkedHours(
	entry: WorkDayLike,
	day: ScheduledDay,
	utcOffsetMinutes: number = ATTENDANCE_UTC_OFFSET_MINUTES
): number {
	const workDate = requiredDateKey(entry.work_date, 'work_days.work_date');
	const shiftStart =
		day.shift == null
			? Number.NEGATIVE_INFINITY
			: midnight(workDate, utcOffsetMinutes) + clockMinutes(day.shift.start_time) * MINUTE_MS;
	return clockedWorkHours(entry, shiftStart);
}

export function deriveDailyOvertime(
	entry: WorkDayLike,
	day: ScheduledDay,
	breaks?: readonly BreakRuleLike[] | null,
	utcOffsetMinutes: number = ATTENDANCE_UTC_OFFSET_MINUTES,
	/** The regime's night window, so a break rule may read `night_hours`; absent reads 0. */
	night?: Pick<NightPremium, 'from' | 'to'> | null,
	/** The person, so a break rule may read their entity's facts; absent reads none. */
	person?: PersonContext | null
): DailyOvertime | null {
	const workDate = requiredDateKey(entry.work_date, 'work_days.work_date');
	if (day.dayType === 'ORDINARY' && day.shift == null) return null;
	const totalWorkHours = dailyWorkedHours(entry, day, utcOffsetMinutes);
	// Attendance only confirms presence: a day nobody attended pays neither entry.
	if (totalWorkHours <= 0) return null;
	const approvedHours = Math.max(0, decodeNumber(entry.approved_overtime_hours ?? 0));
	const incentiveHours = Math.max(0, decodeNumber(entry.incentive_hours ?? 0));
	const hours = approvedHours + incentiveHours;
	if (hours <= 0) return null;
	// What the clock showed beyond the normal day. It is the quantity the rest-break rules assess
	// and it decides no pay.
	const observedBeyond =
		day.dayType === 'ORDINARY' ? Math.max(0, totalWorkHours - day.normalHours) : totalWorkHours;
	/**
	 * The rest break is assessed from the punches, reported, and deducts nothing.
	 *
	 * The trigger is consecutive hours, so the assessment reads `worked_intervals`: a day of
	 * 08:00–19:00 with a 20-minute pause crosses Malaysia's five consecutive hours whether or not any
	 * of it was overtime. `continuousAttendance` is not passed: no column records whether the work
	 * must be carried on continuously, and claiming the proviso would silently swap Malaysia's
	 * five-hour rule for its eight-hour one on every day in the workspace.
	 */
	const nightHours =
		night == null
			? 0
			: (() => {
					const measured = nightWindowHours(entry, night, day.shift, utcOffsetMinutes);
					return measured.ordinary + measured.overtime;
				})();
	const restBreak = restBreakAssessment({
		intervals: entry.worked_intervals ?? [],
		breakMinutes: entry.break_minutes ?? 0,
		breaks,
		overtimeHours: observedBeyond,
		nightHours,
		person: person ?? null
	});
	return {
		date: workDate,
		workDayId: entry.id,
		dayType: day.dayType,
		hours,
		incentiveHours,
		normalHours: day.normalHours,
		totalWorkHours,
		breakMinutes: Math.max(0, decodeNumber(entry.break_minutes ?? 0)),
		// Null rather than a "no rule" assessment: a consumer asking whether a break governed this day
		// should not have to reach two levels in to find out that none did.
		restBreak: restBreak.rule === null ? null : restBreak
	};
}
