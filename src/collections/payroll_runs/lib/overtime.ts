/**
 * Clocks become hours; hours become money.
 *
 * Overtime is **keyed, never derived**: the employer's approval is the record, imported with the
 * roster or entered by the scheduler as `work_days.approved_overtime_hours`, in half-hour steps and
 * inclusive of breaks. Payroll pays that figure and nothing else beyond the shift. An hour the
 * clock shows past the shift with no approval earns nothing — work done is not the same fact as
 * work authorised, and only the approval authorises pay. That is the client's reading, and it is
 * what replaces the pre-refactor engine, which derived the overrun from the punch and paid it.
 *
 * The clock still decides everything else. The ordinary part of the day, the day type, the night
 * window and the statutory rest-break assessment all read `worked_intervals`; a day with no
 * attendance pays no overtime at all, whatever its approval says, because an approval is not a
 * clock. On a REST, OFF or observed public holiday the observed day up to the normal day is
 * premium work and needs no approval — the roster and the calendar made it premium — and only the
 * hours beyond that boundary are the approved figure. Clock-derived parts stay exact to the minute;
 * the keyed part is exact to the half hour the scheduler enters.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * REST-DAY AND PUBLIC-HOLIDAY WORK IS PRICED BY STATUTE, FROM THE SEEDED RULES.
 *
 * Hours up to the normal day pay the highest `FROM_START_OF_DAY` band entered — a day's wages is
 * never paid twice — and only hours beyond the normal day run through the `BEYOND_NORMAL` ladder.
 * That is EA s.60(3) and s.60D(3), and for every other jurisdiction it is whatever that
 * jurisdiction snapshot's `regime.overtime_rules` members say.
 *
 * This deliberately differs from the pre-refactor engine, which paid every clocked hour at a flat
 * multiple of the hourly rate — roughly RM88 per rest day per employee more, and routed to an
 * EPF-liable component where statutory overtime is EPF-exempt. That reading reconciled against the
 * customer's workbook; it is not what the Act says, and the customer's workbook is not the law.
 * The divergence is expected and accounted for (decision E27 / risk register #3).
 *
 * There is no switch. The ladder is data: change the effective-dated regime, not this file.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A STATUTORY REST BREAK CAN REDUCE PAYABLE TIME — BUT ONLY WHERE THE STATUTE SAYS IT IS NOT WORK.
 *
 * `regime.rest_break_rules` is a consecutive-hours rule transcribed from primary text. Overtime is
 * not its trigger and never was: overtime is simply the usual way somebody crosses the trigger,
 * which is exactly why the same rule catches a ten-hour split shift that earned no overtime at all.
 *
 * What reaches money is decided per jurisdiction by `counts_as_worked_time`, and by nothing else:
 *
 *   false → the break is not working time, so a break the employee was owed and did not take is
 *           time they were not working. The shortfall is deducted. Indonesia says so in terms —
 *           UU 13/2003 ps.79(2)(a), "tidak termasuk jam kerja".
 *   true  → the break is paid. The requirement is recorded and nothing is deducted.
 *   null  → THE STATUTE IS SILENT, which is not the same answer as "no". Nothing is ever deducted.
 *           Malaysia is this case: s.60A(1)(a) calls the period "leisure" and says nothing at all
 *           about payment, and `docs/architecture.md` records that as unresolved. Pricing off a
 *           null would be inventing law, in the one direction — downward — where inventing it
 *           takes money from someone who cannot see why.
 *
 * The quantity deducted is the **shortfall**, never the requirement. `clockedWorkHours` has already
 * subtracted the break the entry recorded, so deducting the requirement on top would charge a
 * thirty-minute break twice on every day that actually took one.
 *
 * The shortfall reduces the clock-derived premium hours only, never the keyed approval: the
 * approved figure is inclusive of breaks by the scheduler's own definition, so deducting from it
 * would charge the break twice — once inside the number that was keyed and once here.
 *
 * Absent member, no governing rule, or no shortfall, and the clock-derived arithmetic below is byte
 * for byte what it was before any of this existed. That is asserted in `overtime-derivation.test.ts`,
 * not assumed.
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
import { roundMinute } from './rounding.js';
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
	/** The employer's approved overtime for the day, breaks included; absent reads as none. */
	readonly approved_overtime_hours?: number | null | undefined;
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
	 * The payable quantity: the keyed approval, plus the clock-derived premium a rest, off or
	 * holiday day makes of the observed day up to the normal day — that part net of any unpaid
	 * statutory break shortfall. Never negative, never zero — a zero day is dropped.
	 */
	readonly hours: number;
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
	/**
	 * Hours removed from payable overtime, which is zero unless the statute says the break is not
	 * working time. It is stated rather than left to be re-derived so a payslip can say *why* the
	 * payable figure is below the clocked overrun instead of leaving the employee to find it.
	 */
	readonly restBreakDeductedHours: number;
};

/**
 * Read one day's payable overtime from the keyed approval and the observed day.
 *
 * Returns `null` when the day earns nothing, which is the common case: the gates fire, no
 * attendance was recorded, no hours were approved, or the premium floors away to zero. A day that
 * earns nothing produces no entry at all rather than a zero one, so provenance never claims a
 * payslip line consumed a record it did not.
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
	// An approval is not a clock. A day nobody attended earns no overtime, whatever was keyed for
	// it: the approval authorises hours, and hours are what the punches record.
	if (totalWorkHours <= 0) return null;
	const approvedHours = Math.max(0, decodeNumber(entry.approved_overtime_hours ?? 0));
	// What the clock showed beyond the normal day. It is the quantity the rest-break rules assess
	// and it no longer decides pay: the approved figure does.
	const observedBeyond =
		day.dayType === 'ORDINARY' ? Math.max(0, totalWorkHours - day.normalHours) : totalWorkHours;

	/**
	 * The rest break is assessed from the punches.
	 *
	 * The assessment reads `worked_intervals`, not the payable figure: the trigger is consecutive
	 * hours, and the payable quantity discards the normal day. A day of 08:00–19:00 with a 20-minute
	 * pause crosses Malaysia's five consecutive hours whether or not any of it was overtime —
	 * measuring the trigger off the payable figure would make the rule fire on the tail of a shift
	 * instead of on the stretch the statute describes.
	 *
	 * Only the **shortfall** is deducted, and only where the statute says the break is not working
	 * time. `clockedWorkHours` above has already taken the derived break off the day, so
	 * an entry that recorded its full statutory break deducts nothing further here — it was deducted
	 * once already, and taking the requirement again would charge a half-hour break as a full hour.
	 *
	 * `continuousAttendance` is not passed: no column records whether the work must be carried on
	 * continuously, and the proviso is an exception nobody has asserted. Claiming it here would
	 * silently swap Malaysia's five-hour rule for its eight-hour one on every day in the workspace.
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
	const restBreakDeductedHours =
		restBreak.rule?.counts_as_worked_time === false ? (restBreak.shortfallMinutes ?? 0) / 60 : 0;
	// On an ordinary day the payable quantity is the approval exactly; on a rest, off or holiday day
	// the observed day up to the normal day is already premium, and only the hours beyond it are the
	// approved figure. The shortfall reduces the clock-derived part, never the approval.
	const premiumHours =
		day.dayType === 'ORDINARY'
			? 0
			: Math.max(0, Math.min(totalWorkHours, day.normalHours) - restBreakDeductedHours);
	const hours = roundMinute(Math.max(0, premiumHours + approvedHours));
	if (hours <= 0) return null;
	return {
		date: workDate,
		workDayId: entry.id,
		dayType: day.dayType,
		hours,
		normalHours: day.normalHours,
		totalWorkHours,
		breakMinutes: Math.max(0, decodeNumber(entry.break_minutes ?? 0)),
		// Null rather than a "no rule" assessment: a consumer asking whether a break governed this day
		// should not have to reach two levels in to find out that none did.
		restBreak: restBreak.rule === null ? null : restBreak,
		restBreakDeductedHours
	};
}
