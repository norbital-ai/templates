import { bolt } from '$bolt';
import { Schema } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { parseDateTime, toZoned } from '@internationalized/date';
import { t, type MessageKey } from '../i18n/t.js';

/** One worked interval as `roster_entry.worked_intervals` stores it: ISO instants, `end` null while clocked in. */
export type Interval = { readonly start: string; readonly end: string | null };
/** An editable interval: two `HH:mm` clocks in the entity's zone (the kit's `TimeRange`). */
export type Clock = { start: string | null; end: string | null };

/** One person-day as the board and the calendar draw it. */
export type Day = {
	readonly date: string;
	/** Inside the contract's effective range. */
	readonly employed: boolean;
	readonly entryId: Id<'roster_entry'> | null;
	readonly shift: string | null;
	/** null: no attendance recorded; []: reviewed, nothing worked. */
	readonly intervals: readonly Interval[] | null;
	readonly overtime: number | null;
	readonly incentive: number | null;
	readonly holiday: string | null;
	readonly leave: { readonly code: string; readonly name: string; readonly half: boolean } | null;
	/** The roster entry or the leave is still under approval. */
	readonly pending: boolean;
	/** Settled on a payslip: read-only. */
	readonly locked: boolean;
};

const DAY_MINUTES = 1440;
// ponytail: leave is found by its start date; a leave that started more than this before the window is missed
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
			worked_intervals: true,
			approved_overtime_hours: true,
			incentive_hours: true,
			payslip_id: true,
			approval_id: true
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
			occurred_on: { gte: PlainDate(addDays(from, -LEAVE_LOOKBACK_DAYS)), lte: PlainDate(to) }
		},
		select: {
			employment_id: true,
			occurred_on: true,
			days: true,
			from: true,
			to: true,
			payslip_id: true,
			approval_id: true,
			catalog_id: { select: { code: true, name: true } }
		},
		all: true
	});

/* ── cells ── */

type EntryRow = {
	readonly id: Id<'roster_entry'>;
	readonly employment_id: string;
	readonly work_date: string;
	readonly shift_definition_id?: string | null;
	readonly worked_intervals?: unknown;
	readonly approved_overtime_hours?: unknown;
	readonly incentive_hours?: unknown;
	readonly payslip_id?: string | null;
	readonly approval_id?: string | null;
};
type LeaveRow = {
	readonly employment_id?: string | null;
	readonly occurred_on: string;
	readonly days?: unknown;
	readonly from?: string | null;
	readonly to?: string | null;
	readonly payslip_id?: string | null;
	readonly approval_id?: string | null;
	readonly catalog_id?: { readonly code?: string; readonly name?: string } | null;
};
type HolidayRow = { readonly date: string; readonly name: string };
type Person = { readonly id: string; readonly from: string; readonly to: string | null };

/** A stored decimal as a number: it reaches the client as a `Decimal`, a decimal string or a plain number. */
const numberOrNull = (value: unknown): number | null => {
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
}): Map<string, Day> {
	const entries = new Map(
		input.entries.map((row) => [dayKey(row.employment_id, String(row.work_date).slice(0, 10)), row])
	);
	const holidays = new Map(input.holidays.map((row) => [String(row.date).slice(0, 10), row.name]));
	const leave = new Map<string, LeaveRow>();
	for (const row of input.leave) {
		if (row.employment_id == null) continue;
		const from = String(row.from ?? row.occurred_on).slice(0, 10);
		const to = String(row.to ?? from).slice(0, 10);
		for (const date of datesBetween(from, to)) leave.set(dayKey(row.employment_id, date), row);
	}
	const days = new Map<string, Day>();
	for (const person of input.people)
		for (const date of input.dates) {
			const key = dayKey(person.id, date);
			const entry = entries.get(key);
			const off = leave.get(key);
			days.set(key, {
				date,
				employed: person.from <= date && (person.to == null || date <= person.to),
				entryId: entry?.id ?? null,
				shift: entry?.shift_definition_id ?? null,
				intervals: intervalsOf(entry?.worked_intervals),
				overtime: numberOrNull(entry?.approved_overtime_hours),
				incentive: numberOrNull(entry?.incentive_hours),
				holiday: holidays.get(date) ?? null,
				leave:
					off == null
						? null
						: {
								code: off.catalog_id?.code ?? '',
								name: off.catalog_id?.name ?? '',
								half: (numberOrNull(off.days) ?? 1) < 1
							},
				pending: entry?.approval_id != null || off?.approval_id != null,
				locked: entry?.payslip_id != null || off?.payslip_id != null
			});
		}
	return days;
}

/* ── clocks ── */

/** `HH:mm` of an instant in the zone. */
export const clockOf = (instant: string, timeZone: string): string =>
	new Intl.DateTimeFormat('en-GB', {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).format(new Date(instant));

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

/** First clock-in and last clock-out (`…` while open), in the zone. */
export function clockWindow(intervals: readonly Interval[], timeZone: string): string {
	const first = intervals[0];
	const last = intervals.at(-1);
	if (first == null || last == null) return '';
	return `${clockOf(first.start, timeZone)}–${last.end == null ? '…' : clockOf(last.end, timeZone)}`;
}

/** Everything the cell shows, in words: its accessible name and hover text. */
export function describeDay(day: Day, subject: string, timeZone: string): string {
	if (!day.employed) return `${subject} · ${t('roster.before_employment')}`;
	const parts = [subject];
	if (day.holiday != null) parts.push(`${t('roster.public_holiday')}: ${day.holiday}`);
	if (day.leave != null)
		parts.push(
			`${day.leave.name || t('roster.leave')}${day.leave.half ? ` (${t('roster.half_day')})` : ''}`
		);
	parts.push(
		day.shift == null ? t('roster.unrostered') : t('roster.shift_code', { code: day.shift })
	);
	const minutes = day.intervals == null ? null : workedMinutes(day.intervals);
	const first = day.intervals?.[0];
	parts.push(
		day.intervals == null || first == null
			? t(day.intervals == null ? 'roster.layer_none' : 'roster.layer_awol')
			: minutes == null
				? t('roster.layer_clocked_open', { first: clockOf(first.start, timeZone) })
				: t('roster.layer_clocked_window', {
						first: clockOf(first.start, timeZone),
						last: clockOf(day.intervals.at(-1)?.end ?? first.start, timeZone),
						hours: Math.round((minutes / 60) * 100) / 100
					})
	);
	if (day.overtime != null && day.overtime > 0)
		parts.push(t('roster.planned_overtime_hours', { hours: hoursLabel(day.overtime * 60) }));
	if (day.incentive != null && day.incentive > 0)
		parts.push(t('roster.planned_incentive_hours', { hours: hoursLabel(day.incentive * 60) }));
	if (day.pending) parts.push(t('roster.day_sheet_pending_approval'));
	if (day.locked) parts.push(t('roster.lock_rung_consumed'));
	return parts.join(' · ');
}

export const clocksOf = (intervals: readonly Interval[] | null, timeZone: string): Clock[] =>
	(intervals ?? []).map((interval) => ({
		start: clockOf(interval.start, timeZone),
		end: interval.end == null ? null : clockOf(interval.end, timeZone)
	}));

const minutesOf = (clock: string): number => {
	const [hours, minutes] = clock.split(':').map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
};

const instantAt = (date: string, minutes: number, timeZone: string): string => {
	const day = addDays(date, Math.floor(minutes / DAY_MINUTES));
	const rest = minutes % DAY_MINUTES;
	const clock = `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
	return toZoned(parseDateTime(`${day}T${clock}`), timeZone)
		.toDate()
		.toISOString();
};

/**
 * The clocks of one work date as stored intervals. Clocks run forward through the night: an end at or before its
 * start, or a start before the previous end, is the next day.
 */
export function intervalsFrom(
	date: string,
	clocks: readonly Clock[],
	timeZone: string
): { readonly intervals: Interval[] } | { readonly problem: MessageKey } {
	const intervals: Interval[] = [];
	let offset = 0;
	let previousEnd = -1;
	for (const [index, clock] of clocks.entries()) {
		if (clock.start == null) return { problem: 'roster.day_sheet_problem_missing_start' };
		if (clock.end == null && index < clocks.length - 1)
			return { problem: 'roster.day_sheet_problem_open_not_last' };
		let start = minutesOf(clock.start) + offset;
		if (start < previousEnd) {
			offset += DAY_MINUTES;
			start += DAY_MINUTES;
		}
		let end: number | null = null;
		if (clock.end != null) {
			end = minutesOf(clock.end) + offset;
			if (end <= start) end += DAY_MINUTES;
			previousEnd = end;
		}
		intervals.push({
			start: instantAt(date, start, timeZone),
			end: end == null ? null : instantAt(date, end, timeZone)
		});
	}
	return { intervals };
}
