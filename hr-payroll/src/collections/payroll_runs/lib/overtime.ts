/**
 * Clocks become hours; hours become money.
 *
 * Overtime is the one place payroll depends on what actually happened rather than what was agreed,
 * and it is where a rebuild is most likely to silently change someone's pay. Overtime is **computed
 * here, never stored**: a time entry records punches, and every hour of overtime on this payslip is
 * derived from those punches, the statutory day type and the effective employment terms. Nothing
 * upstream may hand payroll a duration it did not derive, because a stored duration and the clock it
 * came from can disagree, and only one of them is what the employee actually worked.
 *
 * A time entry stores only observed work intervals and one actual unpaid-break total. There is no
 * overtime punch, overtime state or payable overtime field to drift from those observations. On an
 * ordinary day, overtime is the observed work outside the scheduled WORK-code window. On a REST,
 * OFF or observed public holiday, every observed worked hour is overtime. The result is floored to
 * the half hour below, with no one-hour minimum.
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
 * Absent member, no governing rule, or no shortfall, and the arithmetic below is byte for byte what
 * it was before any of this existed. That is asserted in `overtime-derivation.test.ts`, not assumed.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { Equivalence, Number as EffectNumber, Schema } from 'effect';
import type { StatutoryRestBreakRule } from '../../../datatypes/statutory_regime/+definition.js';
import { statutoryOvertimeRuleValueSchema } from '../../../datatypes/statutory_regime/+definition.js';
import {
	restBreakAssessment,
	type RestBreakAssessment
} from '../../../lib/scheduling/rest-break.js';
import type { OvertimeRule } from './configuration.js';
import { monthKey, requiredDateKey, type IsoDate } from './dates.js';
import { floorHalfHour } from './rounding.js';
import {
	RuleDayTypeSchema,
	ruleDayType,
	type DayType,
	type RuleDayType,
	type ScheduledDay
} from './schedule.js';

/**
 * The wall-clock frame attendance is recorded in, in minutes east of UTC.
 *
 * A shift start is a wall-clock time and a punch is an instant, so pairing them needs an offset.
 * Nothing in the schema carries one today — neither `companies` nor `jurisdictions` has a timezone
 * column — so it is stated here, as the pre-refactor engine also did (`ATTENDANCE_TZ_OFFSET`).
 *
 * **This must match the frame the attendance clocks are stored in.** The seed writes them as
 * `+08:00` instants (`2025-12-31T08:17:00.000+08:00`), and both populations — Malaysia and the
 * Philippines — are fixed UTC+8 with no daylight saving, so a single constant is exact for them.
 * Left at 0 it would anchor each work date to UTC midnight and throw the early-clock-in clamp and
 * the shift-end comparison out by eight hours, silently mispricing every overtime hour.
 *
 * This constant is the single place a real timezone column would be consumed once one exists; a
 * third jurisdiction off UTC+8 requires that column rather than a change here.
 */
const ATTENDANCE_UTC_OFFSET_MINUTES = 8 * 60;

/** A rule's pricing identity: day type, authority, band bounds and the award it pays. */
const ruleEquivalence = Equivalence.Struct({
	day_type: Equivalence.strictEqual<string>(),
	authority: Equivalence.strictEqual<string>(),
	band: Equivalence.mapInput(
		Equivalence.Array(Equivalence.strictEqual<string | number | null>()),
		(band: OvertimeRule['band']) =>
			band.measure === 'BEYOND_NORMAL'
				? ['BEYOND_NORMAL', band.from_hours, band.to_hours]
				: ['FROM_START_OF_DAY', band.from_fraction, band.to_fraction]
	),
	award: Equivalence.Struct({
		kind: Equivalence.strictEqual<string>(),
		multiple: Equivalence.strictEqual<number>()
	})
});

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const TimeEntryLikeSchema = Schema.Struct({
	id: Schema.String,
	work_date: Schema.String,
	worked_intervals: Schema.NullOr(
		Schema.Array(
			Schema.Struct({
				start: Schema.String,
				end: Schema.NullOr(Schema.String)
			})
		)
	),
	break_minutes: Schema.Number
});
export type TimeEntryLike = Schema.Schema.Type<typeof TimeEntryLikeSchema>;

/** Minutes since midnight of a `HH:MM[:SS]` wall-clock time. */
export function clockMinutes(value: string): number {
	const [hours, minutes] = value.split(':').map(Number);
	if (!Number.isFinite(hours) || !Number.isFinite(minutes))
		throw new Error(`"${value}" is not a wall-clock time.`);
	return hours! * 60 + minutes!;
}

function instant(value: string): number {
	return Date.parse(value);
}

const IntervalSchema = Schema.Struct({ start: Schema.Number, end: Schema.Number });
type Interval = Schema.Schema.Type<typeof IntervalSchema>;

/**
 * Parse and union the observed intervals. Overlap is rejected by the write hook, but unioning here
 * makes payroll safe against historical/imported duplicates: the same minute can never be paid
 * twice. A missing end is the sole representation of an open clock and blocks the run.
 */
export function normalizedWorkedIntervals(entry: TimeEntryLike): readonly Interval[] {
	const workDate = requiredDateKey(entry.work_date, 'time_entries.work_date');
	if (entry.worked_intervals == null)
		throw new Error(`Time entry on ${workDate} has no worked intervals.`);
	const parsed = entry.worked_intervals
		.map((interval) => {
			// The record, not only the day. Dozens of people clock on any given date, so a refusal that
			// named the date alone told whoever had to fix it which day to search and nothing more.
			if (interval.end == null)
				throw new Error(`Time entry ${entry.id} on ${workDate} is still open.`);
			const start = instant(interval.start);
			const end = instant(interval.end);
			if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
				throw new Error(
					`Time entry ${entry.id} on ${workDate} contains an invalid worked interval ` +
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
function midnight(date: IsoDate): number {
	return Date.parse(`${date}T00:00:00.000Z`) - ATTENDANCE_UTC_OFFSET_MINUTES * MINUTE_MS;
}

/**
 * Hours actually worked on a day, from the clocks.
 *
 * Time clocked before the scheduled start is discarded: an employee who arrives early is not
 * working, and not paid, until their shift begins. The unpaid break is deducted from what remains,
 * never below zero — the schema records a flat `break_minutes` rather than break windows, so an
 * overlap test is not available here (see the note in the module report).
 */
function clockedWorkHours(entry: TimeEntryLike): number {
	const elapsed = normalizedWorkedIntervals(entry).reduce(
		(total, interval) => total + (interval.end - interval.start) / HOUR_MS,
		0
	);
	return Math.max(0, elapsed - Math.max(0, Number(entry.break_minutes)) / 60);
}

/**
 * Hours clocked out after the scheduled end of the shift.
 *
 * An overnight shift ends on the following calendar day, so its end is carried forward whenever it
 * is not after its start. This depends only on the clock-out: arriving late is undertime, deducted
 * separately, and never shortens the overtime earned (decision E4).
 */
function overlapHours(intervals: readonly Interval[], start: number, end: number): number {
	return intervals.reduce(
		(total, interval) =>
			total + Math.max(0, Math.min(interval.end, end) - Math.max(interval.start, start)) / HOUR_MS,
		0
	);
}

/**
 * Hours inside the Philippines' 22:00–06:00 statutory night-work window.
 *
 * Attendance is already assigned to a work date. The window therefore starts at 22:00 on that
 * date and ends at 06:00 the next day, which also handles an overtime punch continuing past the
 * scheduled night shift. The overlap is derived from the actual clock rather than a payroll
 * workbook amount.
 */
export function philippineNightWorkHours(entry: TimeEntryLike): number {
	const workDate = requiredDateKey(entry.work_date, 'time_entries.work_date');
	const nightStart = midnight(workDate) + 22 * HOUR_MS;
	const nightEnd = midnight(workDate) + 30 * HOUR_MS;
	return overlapHours(normalizedWorkedIntervals(entry), nightStart, nightEnd);
}

/** One day's overtime, before it is priced. */
export type DailyOvertime = {
	readonly date: IsoDate;
	readonly timeEntryId: string;
	readonly dayType: DayType;
	/**
	 * Floored to the half hour, and already net of any unpaid statutory break shortfall. Never
	 * negative, never zero — a zero day is dropped, including a day whose whole overrun was consumed
	 * by a break it was owed and did not take.
	 */
	readonly hours: number;
	/** Contracted hours for the day, the boundary `STATUTORY_DAY_WAGE` bands against. */
	readonly normalHours: number;
	/** Actual hours at the employer's disposal, used only to locate the total-work-hours boundary. */
	readonly totalWorkHours: number;
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
 * Derive one day's overtime hours from one attendance record.
 *
 * Returns `null` when the day earns nothing, which is the common case: the gates fire, or the
 * overrun floors away to zero. A day that earns nothing produces no entry at all rather than a
 * zero one, so provenance never claims a payslip line consumed a record it did not.
 *
 * `restBreakRules` is the jurisdiction's transcribed rest-break member, optional in the signature so
 * that a caller which has none — and every caller had none before the member was restored — computes
 * exactly what it computed before. Omitted, null and empty are one statement: no rule governs, so
 * nothing is assessed and nothing is deducted.
 */
export function deriveDailyOvertime(
	entry: TimeEntryLike,
	day: ScheduledDay,
	restBreakRules?: readonly StatutoryRestBreakRule[] | null
): DailyOvertime | null {
	const workDate = requiredDateKey(entry.work_date, 'time_entries.work_date');
	const intervals = normalizedWorkedIntervals(entry);
	const totalWorkHours = clockedWorkHours(entry);
	let raw = totalWorkHours;
	if (day.dayType === 'ORDINARY') {
		if (day.shift == null) return null;
		const startMinutes = clockMinutes(day.shift.start_time);
		let endMinutes = clockMinutes(day.shift.end_time);
		if (day.shift.crosses_midnight || endMinutes <= startMinutes) endMinutes += 1440;
		const shiftStart = midnight(workDate) + startMinutes * MINUTE_MS;
		const shiftEnd = midnight(workDate) + endMinutes * MINUTE_MS;
		const before = overlapHours(intervals, Number.NEGATIVE_INFINITY, shiftStart);
		const after = overlapHours(intervals, shiftEnd, Number.POSITIVE_INFINITY);
		raw = before + after;
	}

	/**
	 * The rest break is assessed from the punches and deducted **before** the half-hour floor.
	 *
	 * The assessment reads `worked_intervals`, not `raw`: the trigger is consecutive hours, and the
	 * overrun this function computes is a different quantity that discards everything inside the
	 * scheduled window. A day of 08:00–19:00 with a 20-minute pause crosses Malaysia's five
	 * consecutive hours whether or not any of it was overtime — measuring the trigger off `raw` would
	 * make the rule fire on the tail of a shift instead of on the stretch the statute describes.
	 *
	 * Only the **shortfall** is deducted, and only where the statute says the break is not working
	 * time. `clockedWorkHours` above has already taken the recorded `break_minutes` off the day, so
	 * an entry that recorded its full statutory break deducts nothing further here — it was deducted
	 * once already, and taking the requirement again would charge a half-hour break as a full hour.
	 *
	 * Deducting before the floor keeps the floor doing one job. Flooring first and subtracting after
	 * would produce payable figures off the half hour, which no other path in this engine can emit.
	 *
	 * `continuousAttendance` is not passed: no column records whether the work must be carried on
	 * continuously, and the proviso is an exception nobody has asserted. Claiming it here would
	 * silently swap Malaysia's five-hour rule for its eight-hour one on every day in the workspace.
	 */
	const restBreak = restBreakAssessment({
		intervals: entry.worked_intervals ?? [],
		breakMinutes: entry.break_minutes,
		rules: restBreakRules
	});
	const restBreakDeductedHours =
		restBreak.rule?.counts_as_worked_time === false ? (restBreak.shortfallMinutes ?? 0) / 60 : 0;
	const hours = floorHalfHour(Math.max(0, raw - restBreakDeductedHours));
	if (hours <= 0) return null;
	return {
		date: workDate,
		timeEntryId: entry.id,
		dayType: day.dayType,
		hours,
		normalHours: day.normalHours,
		totalWorkHours,
		// Null rather than a "no rule" assessment: a consumer asking whether a break governed this day
		// should not have to reach two levels in to find out that none did.
		restBreak: restBreak.rule === null ? null : restBreak,
		restBreakDeductedHours
	};
}

/** A slice of a day's overtime priced by one statutory rule. */
const PricedSegmentSchema = Schema.Struct({
	rule: statutoryOvertimeRuleValueSchema,
	dayType: RuleDayTypeSchema,
	measure: Schema.Literals(['BEYOND_NORMAL', 'FROM_START_OF_DAY']),
	/** The rule band's lower bound, which is how a pay component names the rule it pays. */
	bandFrom: Schema.Number,
	/** Hours in the band. Zero for a day-wage award, which pays flat. */
	hours: Schema.Number,
	/** Multiple of the hourly rate, or of a day's wages for a `DAY_WAGE_MULTIPLE` award. */
	multiple: Schema.Number,
	award: Schema.Literals(['HOURLY_MULTIPLE', 'DAY_WAGE_MULTIPLE']),
	date: Schema.String,
	timeEntryId: Schema.String
});
export type PricedSegment = Schema.Schema.Type<typeof PricedSegmentSchema>;

/** The band triple that names a derived overtime line: day type, measure, floor. */
const OvertimeBandIdentitySchema = Schema.Struct({
	dayType: Schema.Literals(['ORDINARY', 'REST_DAY', 'PUBLIC_HOLIDAY']),
	measure: Schema.Literals(['BEYOND_NORMAL', 'FROM_START_OF_DAY']),
	bandFrom: Schema.Number
});
export type OvertimeBandIdentity = Schema.Schema.Type<typeof OvertimeBandIdentitySchema>;

/**
 * The stable code a derived overtime line is reported under.
 *
 * There is no pay component behind an overtime line, so nothing supplies a code — but a workbook
 * column, an export row and a payslip breakdown all need one, and it has to be the same string
 * every time or a reconciliation stops matching between two runs. The band is that identity, so
 * the code is built from it: `OT_ORDINARY_BEYOND_NORMAL_0`, `OT_REST_DAY_FROM_START_OF_DAY_0_5`,
 * and `OT_EXCESS_…` for the hours the daily total-work boundary reclassified.
 */
export function overtimeBandCode(
	options: OvertimeBandIdentity & { readonly excess: boolean }
): string {
	return [
		'OT',
		...(options.excess ? ['EXCESS'] : []),
		options.dayType,
		options.measure,
		String(options.bandFrom).replace('.', '_')
	].join('_');
}

/** Statutory excess value reclassified to incentive rather than discarded. */
const ExcessHoursSchema = Schema.Struct({
	date: Schema.String,
	timeEntryId: Schema.String,
	dayType: RuleDayTypeSchema,
	measure: Schema.Literals(['BEYOND_NORMAL', 'FROM_START_OF_DAY']),
	bandFrom: Schema.Number,
	hours: Schema.Number,
	/**
	 * Hourly awards store `hours × multiple`; day-wage awards store the additional day-wage
	 * multiple earned beyond the retained statutory OT hours.
	 */
	units: Schema.Number,
	valuedAt: Schema.Literals(['ORDINARY_HOURLY', 'ORDINARY_DAY_WAGE'])
});
export type ExcessHours = Schema.Schema.Type<typeof ExcessHoursSchema>;

type ClassifiedDailyOvertime = {
	readonly day: DailyOvertime;
	/** Hours retained in statutory overtime components after daily and calendar-month controls. */
	readonly retainedHours: number;
	/** Hours routed to incentive components at the same statutory value. */
	readonly excessHours: number;
};

/**
 * Apply Malaysian-style statutory controls in chronological calendar-month order.
 *
 * The monthly counter includes only ordinary-day overtime (OFF_DAY uses the ordinary rule). Work
 * on a rest day or public holiday is expressly excluded by the 1980 Regulations. The counter still
 * advances by the whole qualifying day, even if part of that day already exceeded the daily
 * total-work boundary, so reclassification cannot make statutory hours disappear.
 */
export function classifyOvertimeByCalendarMonth(options: {
	readonly days: readonly DailyOvertime[];
	readonly dailyWorkLimit: number | null;
	readonly monthlyOrdinaryOvertimeLimit: number | null;
}): ClassifiedDailyOvertime[] {
	const ordinaryHoursByMonth = new Map<string, number>();
	return options.days
		.toSorted((left, right) => left.date.localeCompare(right.date))
		.map((day) => {
			const dailyRetained =
				options.dailyWorkLimit == null
					? day.hours
					: Math.max(
							0,
							day.hours - floorHalfHour(Math.max(0, day.totalWorkHours - options.dailyWorkLimit))
						);
			let monthlyRetained = day.hours;
			if (options.monthlyOrdinaryOvertimeLimit != null && ruleDayType(day.dayType) === 'ORDINARY') {
				const month = monthKey(day.date);
				const before = ordinaryHoursByMonth.get(month) ?? 0;
				const clampToDay = EffectNumber.clamp({ minimum: 0, maximum: day.hours });
				monthlyRetained = clampToDay(options.monthlyOrdinaryOvertimeLimit - before);
				ordinaryHoursByMonth.set(month, before + day.hours);
			}
			const retainedHours = Math.min(day.hours, dailyRetained, monthlyRetained);
			return {
				day,
				retainedHours,
				excessHours: day.hours - retainedHours
			};
		});
}

/** Ordinary/off-day OT counted by a calendar-month cap; rest-day and public-holiday work is excluded. */
export function regulatedMonthlyOvertimeHours(
	days: readonly DailyOvertime[],
	period: string
): number {
	return days
		.filter((day) => monthKey(day.date) === period && ruleDayType(day.dayType) === 'ORDINARY')
		.reduce((total, day) => total + day.hours, 0);
}

const ResolvedRuleSchema = Schema.Struct({
	row: statutoryOvertimeRuleValueSchema,
	measure: Schema.Literals(['BEYOND_NORMAL', 'FROM_START_OF_DAY']),
	from: Schema.Number,
	to: Schema.NullOr(Schema.Number),
	award: Schema.Literals(['HOURLY_MULTIPLE', 'DAY_WAGE_MULTIPLE']),
	multiple: Schema.Number
});
type ResolvedRule = Schema.Schema.Type<typeof ResolvedRuleSchema>;

function resolveRule(rule: OvertimeRule): ResolvedRule {
	const { band, award } = rule;
	if (band == null)
		throw new Error(`Overtime rule ${rule.authority} has no band, so no hour can enter it.`);
	if (award == null)
		throw new Error(`Overtime rule ${rule.authority} has no award, so it would pay nothing.`);
	const bounds =
		band.measure === 'BEYOND_NORMAL'
			? { from: band.from_hours, to: band.to_hours }
			: { from: band.from_fraction, to: band.to_fraction };
	return {
		row: rule,
		measure: band.measure,
		from: bounds.from,
		to: bounds.to,
		award: award.kind,
		multiple: award.multiple
	};
}

/** Rules for one day type, ascending by band floor. */
function rulesFor(
	rules: readonly OvertimeRule[],
	dayType: RuleDayType,
	measure: 'BEYOND_NORMAL' | 'FROM_START_OF_DAY'
): ResolvedRule[] {
	const resolved: ResolvedRule[] = [];
	for (const rule of rules) {
		if (rule.day_type !== dayType) continue;
		const candidate = resolveRule(rule);
		if (candidate.measure !== measure) continue;
		resolved.push(candidate);
	}
	return resolved.toSorted((left, right) => left.from - right.from);
}

/**
 * Split a day's hours across a `BEYOND_NORMAL` ladder.
 *
 * Malaysia states one open band per day type, so this collapses to a single segment at a flat
 * multiple. Indonesia bands the first hour beyond normal separately, and the same code splits it.
 * No engine code branches on country.
 */
function spreadAcrossBands(
	hours: number,
	rules: readonly ResolvedRule[],
	offset: number
): { rule: ResolvedRule; hours: number }[] {
	const spread: { rule: ResolvedRule; hours: number }[] = [];
	let remaining = hours;
	let cursor = offset;
	for (const rule of rules) {
		if (remaining <= 0) break;
		const bandTop = rule.to == null ? Number.POSITIVE_INFINITY : rule.to;
		if (cursor >= bandTop) continue;
		const inBand = Math.min(remaining, bandTop - Math.max(cursor, rule.from));
		if (inBand <= 0) continue;
		spread.push({ rule, hours: inBand });
		remaining -= inBand;
		cursor += inBand;
	}
	if (remaining > 0.0001)
		throw new Error(
			`${remaining.toFixed(2)} overtime hours fall outside every band. The last band of a day ` +
				'type must be open-ended, or hours the employee worked go unpaid.'
		);
	return spread;
}

/**
 * Price one day's overtime.
 *
 * Daily and calendar-month controls may split the statutory award between overtime and an
 * incentive component. The legal rate ladder prices the full day first; only the value difference
 * beyond the retained hours is reclassified, never discarded.
 */
export function priceDay(options: {
	readonly day: DailyOvertime;
	readonly rules: readonly OvertimeRule[];
	readonly retainedHours: number;
}): { segments: PricedSegment[]; excess: ExcessHours[] } {
	const dayType = ruleDayType(options.day.dayType);
	const beyondNormal = rulesFor(options.rules, dayType, 'BEYOND_NORMAL');
	if (beyondNormal.length === 0)
		throw new Error(
			`The jurisdiction states no BEYOND_NORMAL overtime rule for a ${dayType}, so ` +
				`${options.day.hours} hours worked on ${options.day.date} could not be priced.`
		);

	// Whether a day's wages is payable is not a setting — it is whether the jurisdiction states a
	// FROM_START_OF_DAY band for this day type. Malaysia does, for rest days and public holidays
	// (EA s.60(3), s.60D(3)); Singapore states a single open hourly band and so pays no day wage.
	// Adding or removing that entitlement is a regime member, never a code change.
	const dayWageRules = rulesFor(options.rules, dayType, 'FROM_START_OF_DAY');
	const usesDayWage = dayWageRules.length > 0;

	const statutorySegments = (hours: number): PricedSegment[] => {
		const withinNormalDay = usesDayWage ? Math.min(hours, options.day.normalHours) : 0;
		const hourlyHours = hours - withinNormalDay;
		const segments: PricedSegment[] = [];
		if (usesDayWage && withinNormalDay > 0 && options.day.normalHours > 0) {
			// A day's wages is not paid twice: the highest band the day entered wins.
			const fraction = withinNormalDay / options.day.normalHours;
			const entered = dayWageRules.filter((rule) => fraction > rule.from);
			const highest = entered[entered.length - 1];
			if (!highest)
				throw new Error(
					`The jurisdiction states no FROM_START_OF_DAY rule covering ${fraction.toFixed(2)} of a ` +
						`normal day on a ${dayType}. Rest-day work under that fraction would be unpaid.`
				);
			segments.push({
				rule: highest.row,
				dayType,
				measure: 'FROM_START_OF_DAY',
				bandFrom: highest.from,
				hours: withinNormalDay,
				multiple: highest.multiple,
				award: highest.award,
				date: options.day.date,
				timeEntryId: options.day.timeEntryId
			});
		}

		// The `BEYOND_NORMAL` ladder is measured in hours beyond the normal day, so it always starts
		// at zero: the normal day has already been valued by the day-wage ladder where one exists.
		for (const slice of spreadAcrossBands(hourlyHours, beyondNormal, 0)) {
			segments.push({
				rule: slice.rule.row,
				dayType,
				measure: 'BEYOND_NORMAL',
				bandFrom: slice.rule.from,
				hours: slice.hours,
				multiple: slice.rule.multiple,
				award: slice.rule.award,
				date: options.day.date,
				timeEntryId: options.day.timeEntryId
			});
		}
		return segments;
	};

	const full = statutorySegments(options.day.hours);
	const clampHours = EffectNumber.clamp({ minimum: 0, maximum: options.day.hours });
	const keptHours = clampHours(options.retainedHours);
	if (keptHours === options.day.hours) return { segments: full, excess: [] };

	// Classification happens after statutory pricing, through the same legal ladder.
	const kept = statutorySegments(keptHours);
	const excess: ExcessHours[] = [];

	const fullDayWage = full.find((segment) => segment.award === 'DAY_WAGE_MULTIPLE');
	if (fullDayWage) {
		const keptDayWage =
			kept.find((segment) => segment.award === 'DAY_WAGE_MULTIPLE')?.multiple ?? 0;
		const additionalMultiple = fullDayWage.multiple - keptDayWage;
		if (additionalMultiple > 0) {
			excess.push({
				date: options.day.date,
				timeEntryId: options.day.timeEntryId,
				dayType,
				measure: fullDayWage.measure,
				bandFrom: fullDayWage.bandFrom,
				hours:
					Math.min(options.day.hours, options.day.normalHours) -
					Math.min(keptHours, options.day.normalHours),
				units: additionalMultiple,
				valuedAt: 'ORDINARY_DAY_WAGE'
			});
		}
	}

	// Two rules are the same when every member that prices an hour matches — one rule, one rate.
	for (const fullHourly of full.filter((segment) => segment.award === 'HOURLY_MULTIPLE')) {
		const keptHours =
			kept.find((segment) => ruleEquivalence(segment.rule, fullHourly.rule))?.hours ?? 0;
		const movedHours = fullHourly.hours - keptHours;
		if (movedHours <= 0) continue;
		excess.push({
			date: options.day.date,
			timeEntryId: options.day.timeEntryId,
			dayType,
			measure: fullHourly.measure,
			bandFrom: fullHourly.bandFrom,
			hours: movedHours,
			units: movedHours * fullHourly.multiple,
			valuedAt: 'ORDINARY_HOURLY'
		});
	}
	return { segments: kept, excess };
}
