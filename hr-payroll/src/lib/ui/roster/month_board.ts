import { bolt } from '$bolt';
import { Result, Schema } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { fromAbsolute, parseDateTime, toCalendarDateTime, toZoned } from '@internationalized/date';
import { t, type MessageKey } from '../i18n/t.js';
import type { PlannedShift } from '../../payroll_engine/shift_pattern.js';
import { creditAttendance, type AttendancePolicy } from '../../payroll_engine/payslip/context.js';
import { consumedLeaveCovers } from '../../payroll_engine/leave.js';

/** One worked interval as `roster_entry.worked_intervals` stores it: ISO instants, `end` null while clocked in. */
export type Interval = { readonly start: string; readonly end: string | null };
/** Individually edited local calendar datetimes in the entity's zone. */
export type Clock = { start: string | null; end: string | null };
/** `roster_entry.approved_overtime_intervals`: an approved window with its documented unpaid break, when recorded. */
const ApprovedOvertimeInterval = Schema.Struct({
	start: Schema.String,
	end: Schema.String,
	break_minutes: Schema.optionalKey(Schema.NullOr(Schema.Number))
});
const ApprovedOvertimeIntervals = Schema.Array(ApprovedOvertimeInterval);
type ApprovedOvertimeInterval = Schema.Schema.Type<typeof ApprovedOvertimeInterval>;

/** One person-day as the board and the calendar draw it. */
export type Day = {
	readonly date: string;
	/** Inside the contract's effective range. */
	readonly employed: boolean;
	readonly entryId: Id<'roster_entry'> | null;
	/** Only the shift explicitly stored on the work day, never the pattern fallback. */
	readonly shift: string | null;
	readonly shiftId: string | null;
	/** The pattern's expectation is projected only while no explicit shift has been planned. */
	readonly projectedShift: string | null;
	readonly pattern: PlannedShift | null;
	readonly plannedOvertime: number | null;
	readonly approvedOvertimeIntervals: readonly ApprovedOvertimeInterval[] | null;
	/** The effective payroll shift, from the explicit plan or pattern fallback. */
	readonly planned: PlannedShift | null;
	/** null: no attendance recorded; []: reviewed, nothing worked. */
	readonly intervals: readonly Interval[] | null;
	readonly overtime: number | null;
	readonly completion: ReturnType<typeof creditAttendance> | null;
	readonly holiday: string | null;
	readonly leave: { readonly code: string; readonly name: string; readonly half: boolean } | null;
	/** The roster entry or the leave is still under approval. */
	/** Settled on a payslip: read-only. */
	readonly locked: boolean;
};

// ponytail: a leave without a last day is found by its start; one that started more than this before the window is missed
const LEAVE_LOOKBACK_DAYS = 180;

export const dayKey = (employmentId: string, date: string): string => `${employmentId}:${date}`;

export function addDays(date: string, days: number): string {
	const stamp = new Date(`${date}T00:00:00Z`);
	stamp.setUTCDate(stamp.getUTCDate() + days);
	return stamp.toISOString().slice(0, 10);
}

/** Every `YYYY-MM-DD` from `from` to `to`, both inclusive. */
export function datesBetween(from: string, to: string): string[] {
	const dates: string[] = [];
	for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
	return dates;
}

/** Monday-first weeks over the dates, padded with nulls. */
export function weeksOf(dates: readonly string[]): (string | null)[][] {
	const first = dates[0];
	if (first == null) return [];
	const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
	const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...dates];
	while (cells.length % 7 !== 0) cells.push(null);
	return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

export const isWeekend = (date: string): boolean => {
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	return day === 0 || day === 6;
};

/* ── reads: one per source, shared by the board and the calendar ── */

export const entryRead = (ids: readonly Id<'employment_contract'>[], from: string, to: string) =>
	bolt.read('roster_entry', {
		where: {
			employment_id: { in: [...ids] },
			work_date: { gte: PlainDate(from), lte: PlainDate(to) }
		},
		select: {
			employment_id: true,
			work_date: true,
			shift_definition_id: true,
			planned_overtime_hours: true,
			approved_overtime_intervals: true,
			worked_intervals: true,
			payslip_id: true
		},
		all: true
	});

export const holidayRead = (companyId: Id<'entity'>, from: string, to: string) =>
	bolt.read('holiday', {
		where: {
			company_id: { eq: companyId },
			published_at: { isNull: false },
			date: { gte: PlainDate(from), lte: PlainDate(to) }
		},
		select: { date: true, name: true },
		all: true
	});

export const leaveRead = (ids: readonly Id<'employment_contract'>[], from: string, to: string) =>
	bolt.read('leave_catalog_entry', {
		where: {
			employment_id: { in: [...ids] },
			activity: { eq: 'TIME_OFF' },
			occurred_on: { lte: PlainDate(to) },
			// A leave reaching into the window by its last day, however long ago it started.
			or: [
				{ to: { gte: PlainDate(from) } },
				{
					to: { isNull: true },
					occurred_on: { gte: PlainDate(addDays(from, -LEAVE_LOOKBACK_DAYS)) }
				}
			]
		},
		select: {
			employment_id: true,
			occurred_on: true,
			days: true,
			from: true,
			to: true,
			half_day_start: true,
			half_day_end: true,
			payslip_id: true,
			catalog_id: { select: { code: true, name: true } }
		},
		all: true
	});

export const shiftRead = (companyId: Id<'entity'>) =>
	bolt.read('shift_definition', {
		where: { company_id: { eq: companyId } },
		select: { code: true, variant: true },
		all: true
	});

export const patternRead = (companyId: Id<'entity'>) =>
	bolt.read('shift_pattern', {
		where: { company_id: { eq: companyId } },
		select: { pattern: true, effective_range: true },
		all: true
	});

/* ── cells ── */

type EntryRow = {
	readonly id: Id<'roster_entry'>;
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id?: string | null;
	readonly planned_overtime_hours?: unknown;
	readonly approved_overtime_intervals?: unknown;
	readonly worked_intervals?: unknown;
	readonly payslip_id?: string | null;
};
type LeaveRow = {
	readonly employment_id?: string | null;
	readonly occurred_on: string;
	readonly days?: unknown;
	readonly from?: string | null;
	readonly to?: string | null;
	readonly half_day_start?: boolean | null;
	readonly half_day_end?: boolean | null;
	readonly payslip_id?: string | null;

	readonly catalog_id?: { readonly code?: string; readonly name?: string } | null;
};
type HolidayRow = { readonly date: string; readonly name: string };
type Person = { readonly id: string; readonly from: string; readonly to: string | null };

/** A stored decimal as a number: it reaches the client as a `Decimal`, a decimal string or a plain number. */
export const numberOrNull = (value: unknown): number | null => {
	if (value == null || value === '') return null;
	const parsed =
		value instanceof Decimal
			? Schema.decodeUnknownSync(Schema.NumberFromString)(value.toString())
			: Schema.is(Schema.String)(value)
				? Schema.decodeUnknownSync(Schema.NumberFromString)(value)
				: value;
	return Schema.is(Schema.Number)(parsed) && Number.isFinite(parsed) ? parsed : null;
};

/** The stored intervals, or null when none were recorded (or the value is not a list of intervals). */
export function intervalsOf(value: unknown): Interval[] | null {
	if (!Array.isArray(value)) return null;
	const intervals: Interval[] = [];
	for (const item of value) {
		if (!Schema.is(Schema.Record(Schema.String, Schema.Unknown))(item) || !('start' in item))
			return null;
		const end = 'end' in item && item['end'] != null ? String(item['end']) : null;
		intervals.push({ start: String(item['start']), end });
	}
	return intervals;
}

/** Every person-day of `dates`, keyed `dayKey(employment, date)`. */
export function buildDays(input: {
	readonly dates: readonly string[];
	readonly people: readonly Person[];
	readonly entries: readonly EntryRow[];
	readonly holidays: readonly HolidayRow[];
	readonly leave: readonly LeaveRow[];
	readonly timeZone: string;
	/** The governing version's `payroll.attendance`; null leaves every day's credit unknown. */
	readonly policy: AttendancePolicy | null;
	/** A day's planned shift: the rostered definition, else the one the person's pattern plans; null when none. */
	readonly shiftOf?: (
		employmentId: string,
		date: string,
		rostered: string | null
	) => (PlannedShift & { readonly id?: string }) | null;
}): Map<string, Day> {
	const entries = new Map(
		input.entries.map((row) => [dayKey(row.employment_id, String(row.work_date).slice(0, 10)), row])
	);
	const holidays = new Map(input.holidays.map((row) => [String(row.date).slice(0, 10), row.name]));
	const leave = new Map<
		string,
		{
			readonly codes: readonly string[];
			readonly names: readonly string[];
			readonly coverage: number;
		}
	>();
	for (const row of input.leave) {
		if (row.employment_id == null) continue;
		const from = String(row.from ?? row.occurred_on).slice(0, 10);
		const to = String(row.to ?? from).slice(0, 10);
		for (const date of input.dates) {
			if (date < from || date > to) continue;
			const key = dayKey(row.employment_id, date);
			const before = leave.get(key);
			const units = numberOrNull(row.days) ?? 1;
			const half =
				(date === from && row.half_day_start === true) ||
				(date === to && row.half_day_end === true) ||
				(from === to && units > 0 && units < 1);
			leave.set(key, {
				codes: [...new Set([...(before?.codes ?? []), row.catalog_id?.code ?? ''].filter(Boolean))],
				names: [...new Set([...(before?.names ?? []), row.catalog_id?.name ?? ''].filter(Boolean))],
				coverage: (before?.coverage ?? 0) + (half ? 0.5 : 1)
			});
		}
	}
	const days = new Map<string, Day>();
	for (const person of input.people)
		for (const date of input.dates) {
			const key = dayKey(person.id, date);
			const entry = entries.get(key);
			const off = leave.get(key);
			const shiftId = entry?.shift_definition_id ?? null;
			const pattern = input.shiftOf?.(person.id, date, null) ?? null;
			const planned =
				shiftId == null ? pattern : (input.shiftOf?.(person.id, date, shiftId) ?? null);
			const intervals = intervalsOf(entry?.worked_intervals);
			const plannedOvertime = numberOrNull(entry?.planned_overtime_hours);
			const approvedIntervals = entry?.approved_overtime_intervals;
			const approvedOvertimeIntervals = Schema.is(ApprovedOvertimeIntervals)(approvedIntervals)
				? approvedIntervals
				: null;
			const approvedOvertime = shiftId == null ? 0 : plannedOvertime;
			const completion = completionOf(
				intervals,
				planned,
				date,
				input.timeZone,
				input.policy,
				approvedOvertime,
				approvedOvertimeIntervals
			);
			days.set(key, {
				date,
				employed: person.from <= date && (person.to == null || date <= person.to),
				entryId: entry?.id ?? null,
				shift: shiftId == null ? null : (planned?.code ?? shiftId),
				shiftId,
				projectedShift: shiftId == null ? (pattern?.code ?? null) : null,
				pattern,
				plannedOvertime,
				approvedOvertimeIntervals,
				planned,
				intervals,
				overtime: completion?.overtime_hours ?? null,
				completion,
				holiday: holidays.get(date) ?? null,
				leave:
					off == null
						? null
						: {
								code: off.codes.join('/'),
								name: off.names.join(' / '),
								half: off.coverage < 1
							},
				locked: entry?.payslip_id != null || consumedLeaveCovers(input.leave, person.id, date)
			});
		}
	return days;
}

/** Reviewed zero attendance is an absence only on an uncovered planned work day. */
export const isAbsent = (day: Day): boolean =>
	day.employed &&
	day.intervals?.length === 0 &&
	day.planned?.day_type === 'WORK' &&
	day.holiday == null &&
	(day.leave == null || day.leave.half);

/* ── clocks ── */

/** The recorded calendar date and clock, including seconds, in the entity's zone. */
export const clockStampOf = (instant: string, timeZone: string): string =>
	new Intl.DateTimeFormat('en-GB', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).format(new Date(instant));

/** One approved overtime window, read-only, with its unpaid break when one was recorded. */
export const approvedWindowText = (interval: ApprovedOvertimeInterval, timeZone: string): string =>
	`${clockStampOf(interval.start, timeZone)}–${clockStampOf(interval.end, timeZone)}${
		interval.break_minutes != null && interval.break_minutes > 0
			? ` · ${t('roster.approved_break', { minutes: interval.break_minutes })}`
			: ''
	}`;

/**
 * The day's overtime as payroll counts it: the recorded hours net of the shift's break past its ordinary hours, in
 * completed half-hours; null before a closed attendance.
 */
export function overtimeOf(
	intervals: readonly Interval[] | null,
	planned: PlannedShift | null,
	date: string,
	timeZone: string,
	policy: AttendancePolicy | null,
	plannedOvertime?: number | null,
	approvedOvertimeIntervals?: readonly ApprovedOvertimeInterval[] | null
): number | null {
	return (
		completionOf(
			intervals,
			planned,
			date,
			timeZone,
			policy,
			plannedOvertime,
			approvedOvertimeIntervals
		)?.overtime_hours ?? null
	);
}

/** The same clipped, rounded credit as payroll; unknown or open clocks remain unknown. */
export function completionOf(
	intervals: readonly Interval[] | null,
	planned: PlannedShift | null,
	date: string,
	timeZone: string,
	policy: AttendancePolicy | null,
	plannedOvertime?: number | null,
	approvedOvertimeIntervals?: readonly ApprovedOvertimeInterval[] | null
): ReturnType<typeof creditAttendance> | null {
	if (policy == null || intervals == null || intervals.some((interval) => interval.end == null))
		return null;
	return creditAttendance({
		date,
		intervals,
		planned,
		plannedOvertimeHours: plannedOvertime ?? null,
		approvedOvertimeIntervals: approvedOvertimeIntervals ?? null,
		timeZone,
		policy
	});
}

/** Minutes worked, or null while an interval is still open. */
export function workedMinutes(intervals: readonly Interval[]): number | null {
	let minutes = 0;
	for (const interval of intervals) {
		if (interval.end == null) return null;
		minutes += (Date.parse(interval.end) - Date.parse(interval.start)) / 60_000;
	}
	return Math.round(minutes);
}

/** `8.5h`: hours to two decimals, trimmed. */
export const hoursLabel = (minutes: number): string => `${Math.round((minutes / 60) * 100) / 100}h`;

/** Everything the cell shows, in words: its accessible name and hover text. */
export function describeDay(day: Day, subject: string, timeZone: string): string {
	if (!day.employed) return `${subject} · ${t('roster.before_employment')}`;
	const parts = [subject];
	if (day.holiday != null) parts.push(`${t('roster.public_holiday')}: ${day.holiday}`);
	if (day.leave != null)
		parts.push(
			`${day.leave.name || t('roster.leave')}${day.leave.half ? ` (${t('roster.half_day')})` : ''}`
		);
	if (day.projectedShift != null)
		parts.push(`${t('roster.plan_projected')}: ${day.projectedShift}`);
	parts.push(`${t('roster.plan_recorded')}: ${day.shift ?? '—'}`);
	if (day.plannedOvertime != null)
		parts.push(`${t('roster.planned_overtime')}: ${hoursLabel(day.plannedOvertime * 60)}`);
	if (day.approvedOvertimeIntervals != null && day.approvedOvertimeIntervals.length > 0)
		parts.push(
			`${t('roster.approved_overtime_times')}: ${day.approvedOvertimeIntervals.map((interval) => approvedWindowText(interval, timeZone)).join('; ')}`
		);
	const minutes = day.intervals == null ? null : workedMinutes(day.intervals);
	const first = day.intervals?.[0];
	if (day.intervals == null) parts.push(t('roster.layer_none'));
	else if (first == null) {
		if (isAbsent(day)) parts.push(t('roster.layer_awol'));
	} else
		parts.push(
			minutes == null
				? t('roster.layer_clocked_open', { first: clockStampOf(first.start, timeZone) })
				: t('roster.layer_clocked_window', {
						first: clockStampOf(first.start, timeZone),
						last: clockStampOf(day.intervals.at(-1)?.end ?? first.start, timeZone),
						hours: Math.round((minutes / 60) * 100) / 100
					})
		);
	if (day.overtime != null && day.overtime > 0)
		parts.push(t('roster.planned_overtime_hours', { hours: hoursLabel(day.overtime * 60) }));
	if (day.completion?.percent != null)
		parts.push(
			t('roster.completion_details', {
				percent: Math.floor(day.completion.percent),
				credited: hoursLabel(day.completion.credited_hours * 60),
				target: hoursLabel(day.completion.target_hours * 60)
			})
		);
	if (day.locked) parts.push(t('roster.lock_rung_consumed'));
	return parts.join(' · ');
}

export const clocksOf = (intervals: readonly Interval[] | null, timeZone: string): Clock[] =>
	(intervals ?? []).map((interval) => ({
		start: toCalendarDateTime(fromAbsolute(Date.parse(interval.start), timeZone)).toString(),
		end:
			interval.end == null
				? null
				: toCalendarDateTime(fromAbsolute(Date.parse(interval.end), timeZone)).toString()
	}));

/** Explicit dates preserve overnight and previous-day clocks; no clock infers a different day. */
export function intervalsFrom(
	clocks: readonly Clock[],
	timeZone: string
): { readonly intervals: Interval[] } | { readonly problem: MessageKey } {
	const intervals: Interval[] = [];
	let previousEnd = -1;
	const recorded = clocks.filter((clock) => clock.start != null || clock.end != null);
	const instant = (value: string) =>
		Result.try(() => toZoned(parseDateTime(value), timeZone).toDate().toISOString());
	for (const [index, clock] of recorded.entries()) {
		if (clock.start == null) return { problem: 'roster.day_sheet_problem_missing_start' };
		if (clock.end == null && index < recorded.length - 1)
			return { problem: 'roster.day_sheet_problem_open_not_last' };
		const start = instant(clock.start);
		if (Result.isFailure(start)) return { problem: 'roster.day_sheet_problem_invalid_clock' };
		if (Date.parse(start.success) < previousEnd)
			return { problem: 'roster.day_sheet_problem_clock_overlap' };
		let end: string | null = null;
		if (clock.end != null) {
			const parsed = instant(clock.end);
			if (Result.isFailure(parsed)) return { problem: 'roster.day_sheet_problem_invalid_clock' };
			if (Date.parse(parsed.success) <= Date.parse(start.success))
				return { problem: 'roster.day_sheet_problem_clock_order' };
			end = parsed.success;
			previousEnd = Date.parse(end);
		}
		intervals.push({ start: start.success, end });
	}
	return { intervals };
}
