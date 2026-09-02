/**
 * Calendar helpers used by the app pages for *display* only.
 *
 * Nothing here decides payroll: the period window, cutoff handling and pay-date shifting that a
 * run is actually built with belong to the payroll engine and reach the UI as stored
 * `payroll_runs.pay_date` / `attendance_from` / `attendance_to` columns. These functions only put
 * a company's `pay_day` on a calendar so an operator can see which cycles are still open.
 */

import { Number as EffectNumber, Result } from 'effect';
import { formatDateISO, isCalendarDate } from '@norbital-ai/std/date';
import { decodeNumber } from '@norbital-ai/std/json';

import type { CollectionInitialFilter } from '@norbital-ai/ui/collection-surface';

/** The business timezone every calendar-day default and `contains_date` filter resolves in. */
export const PAYROLL_TIME_ZONE = 'Asia/Kuala_Lumpur';

/** Calendar date for an instant in an IANA timezone, formatted as YYYY-MM-DD. */
// Every template workspace is a self-contained publishable unit with its own lockfile and no
// cross-template import surface, so this helper is deliberately owned per template.
export function calendarDateInTimeZone(value: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(value);
	const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? '';
	return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}

/**
 * Calendar day of "now" in the payroll timezone — the reference every board on these pages is drawn
 * against, and the operand every `effective_range: { contains_date: … }` filter is prefilled with.
 *
 * `now` is injectable so a caller with its own clock (an effect reading one, or a test) can hand the
 * instant over; the default stays the parameter-default exemption — the calendar is a display helper
 * and `new Date()` here is the ordinary reading of "now".
 *
 * This used to be `new Date().toISOString().slice(0, 10)`, which is the *UTC* day.
 * `dates-and-time.md` names that expression as forbidden for exactly this use: for eight hours of
 * every day it selects yesterday's rate row, so a server hook could price against a different day
 * than the client had displayed.
 */
export function todayKey(now: Date = new Date()): string {
	return calendarDateInTimeZone(now, PAYROLL_TIME_ZONE);
}

/**
 * The condition an effective-dated list opens on: the versions in force today.
 *
 * Seeded into `CollectionTable`'s own filter builder rather than baked into `query.where`, so it
 * reads as a chip beside every other condition and the operator can drop it to see superseded rows.
 * Clearing it is remembered per view, so it does not come back on the next load.
 *
 * The operand is a **calendar day**, not `todayInstant()`. That is not an inconsistency with the
 * `where` clauses elsewhere on these pages: the filter builder edits `contains_date` with a date
 * picker and `collectionFilterClause` converts the chosen day to an instant on its way to the wire,
 * so handing it an instant here would double-convert. A `where` clause has no such step and still
 * needs `todayInstant()`.
 */
export function inForceTodayFilter(): readonly CollectionInitialFilter[] {
	return [{ field: 'effective_range', operator: 'contains_date', value: todayKey() }];
}

/**
 * The condition a *person* list opens on: someone with an employment in force today.
 *
 * People is a list of `employees`, and effective dating lives on `employments`, so the chip filters
 * across the relation. A relation condition is existential — it selects a person who has *some*
 * employment in force — which is why the surrounding `query.where` still scopes the list to the
 * employees of the selected entity. One consequence worth knowing: somebody who left this entity
 * but is currently employed by another company in the workspace satisfies the chip, because "has an
 * employment in force" and "has an employment here" are two conditions and a relation filter cannot
 * insist that one employment satisfies both.
 */
export function employedTodayFilter(): readonly CollectionInitialFilter[] {
	return [
		{ field: 'employment_employee.effective_range', operator: 'contains_date', value: todayKey() }
	];
}

/** How far `timeZone` is ahead of UTC at `at`, in milliseconds. */
function timeZoneOffsetMs(at: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(at);
	const field = (type: Intl.DateTimeFormatPartTypes) =>
		decodeNumber(parts.find((part) => part.type === type)?.value ?? '0');
	const wallClockAsUtc = Date.UTC(
		field('year'),
		field('month') - 1,
		field('day'),
		field('hour'),
		field('minute'),
		field('second')
	);
	return wallClockAsUtc - at.getTime();
}

/**
 * The canonical UTC instant at which `calendarDate` begins in `timeZone`.
 *
 * A `custom('instant_range', { precision: 'day' })` bound is an instant, and its picker offers a calendar day. Appending `Z` to that
 * day — `` `${date}T00:00:00.000Z` `` — labels local wall time as UTC, which
 * [dates-and-time.md](../../../../skills/authoring-tenant-workspace/references/dates-and-time.md)
 * forbids: east of Greenwich it places the boundary eight hours into the previous local day.
 *
 * The offset is resolved twice because the zone's offset at UTC midnight and at the corrected
 * instant can differ across a daylight-saving transition; the second pass settles on the offset
 * actually in force at the answer.
 */
export function startOfDayInstant(calendarDate: string, timeZone: string): string {
	if (!isCalendarDate(calendarDate)) {
		throw new Error(`"${calendarDate}" is not a YYYY-MM-DD calendar date.`);
	}
	const utcMidnight = new Date(`${calendarDate}T00:00:00.000Z`);
	const firstPass = new Date(utcMidnight.getTime() - timeZoneOffsetMs(utcMidnight, timeZone));
	return new Date(utcMidnight.getTime() - timeZoneOffsetMs(firstPass, timeZone)).toISOString();
}

/**
 * Represent a calendar-day key as the instant the platform day picker expects.
 *
 * A nested custom datatype can deliberately store `YYYY-MM-DD` rather than an instant. The
 * platform's canonical day picker still edits an `instant`, so its adapter must place that day at
 * midnight in the viewer's timezone. UTC midnight would show the previous day for viewers west of
 * Greenwich.
 */
export function calendarDayAsPickerInstant(calendarDate: string, pickerTimeZone: string): string {
	return startOfDayInstant(calendarDate, pickerTimeZone);
}

/** Recover the calendar-day key selected by a platform day picker in the viewer's timezone. */
export function calendarDayFromPickerInstant(value: string, pickerTimeZone: string): string {
	const instant = new Date(value);
	if (Number.isNaN(instant.getTime())) throw new Error(`"${value}" is not a valid instant.`);
	return calendarDateInTimeZone(instant, pickerTimeZone);
}

/** The canonical range shape accepted by a day-precision platform picker. */
export interface DayPickerInstantRange {
	readonly start: string;
	readonly end?: string;
}

/**
 * Present a stored calendar-day instant range to a viewer without changing either visible day.
 * An absent upper bound stays absent rather than becoming a made-up sentinel date.
 */
export function instantRangeAsDayPickerValue(
	range: Readonly<{ start: string; end: string | null }>,
	calendarTimeZone: string,
	pickerTimeZone: string
): DayPickerInstantRange {
	const pickerBound = (value: string) =>
		calendarDayAsPickerInstant(
			calendarDateInTimeZone(new Date(value), calendarTimeZone),
			pickerTimeZone
		);
	return range.end === null
		? { start: pickerBound(range.start) }
		: { start: pickerBound(range.start), end: pickerBound(range.end) };
}

/** Translate a day-precision picker range back to calendar boundaries in the business timezone. */
export function instantRangeFromDayPickerValue(
	value: unknown,
	calendarTimeZone: string,
	pickerTimeZone: string
): { readonly start: string; readonly end: string | null } | null {
	if (value == null || typeof value !== 'object') return null;
	const start = Reflect.get(value, 'start');
	const end = Reflect.get(value, 'end');
	if (typeof start !== 'string' || (end != null && typeof end !== 'string')) return null;
	return Result.getOrElse(
		Result.try(() => ({
			start: startOfDayInstant(
				calendarDayFromPickerInstant(start, pickerTimeZone),
				calendarTimeZone
			),
			end:
				end == null
					? null
					: startOfDayInstant(calendarDayFromPickerInstant(end, pickerTimeZone), calendarTimeZone)
		})),
		() => null
	);
}

/** A calendar day shifted by whole days without involving the browser's local timezone. */
export function shiftDayKey(day: string, days: number): string {
	const parsed = new Date(`${day}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime()))
		throw new Error(`"${day}" is not a YYYY-MM-DD calendar date.`);
	parsed.setUTCDate(parsed.getUTCDate() + Math.trunc(days));
	return parsed.toISOString().slice(0, 10);
}

/** `YYYY-MM` of a UTC calendar day (string key or live `date()` column value). */
export function monthKey(date: string | Date): string {
	return formatDateISO(date).slice(0, 7);
}

/** `YYYY-MM` offset by whole months. */
export function shiftMonthKey(period: string, months: number): string {
	const year = decodeNumber(period.slice(0, 4));
	const month = decodeNumber(period.slice(5, 7));
	const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
	return shifted.toISOString().slice(0, 7);
}

/** Number of days in the `YYYY-MM` month. */
export function daysInMonth(period: string): number {
	const year = decodeNumber(period.slice(0, 4));
	const month = decodeNumber(period.slice(5, 7));
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The calendar day a `pay_day`-of-month falls on for one period, clamped to the month's length so
 * a 31st pay day still resolves in February.
 */
export function payDateFor(period: string, payDay: number): string {
	const day = EffectNumber.clamp({ minimum: 1, maximum: daysInMonth(period) })(payDay);
	return `${period}-${String(day).padStart(2, '0')}`;
}

/** Whole days from `from` to `to`, negative when `to` is in the past. */
export function daysBetweenKeys(from: string, to: string): number {
	return Math.ceil(
		(Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000
	);
}

/** The `YYYY-MM` periods spanning `count` months, ending `ahead` months after the current month. */
export function periodWindow(count: number, ahead: number): string[] {
	const current = monthKey(todayKey());
	return Array.from({ length: count }, (_value, index) =>
		shiftMonthKey(current, ahead - count + 1 + index)
	);
}

/**
 * "Now", as the instant a `contains_date` filter wants.
 *
 * `todayKey()` is a calendar day, and a calendar day is not an instant — the server refuses one
 * rather than guessing which timezone turns it into a moment. This resolves it through the payroll
 * timezone, which is the perspective every effective-dated list on these screens is read from.
 */
export function todayInstant(): string {
	return startOfDayInstant(todayKey(), PAYROLL_TIME_ZONE);
}

/**
 * Calendar `YYYY-MM-DD` for a stored person-day `work_date`.
 *
 * The column is `instant({ precision: 'day' })`. Live rows arrive as the instant that day begins in
 * the payroll zone (`2026-02-01` → `2026-01-31T16:00:00.000Z` in Asia/Kuala_Lumpur), not as a
 * calendar string. `formatDateISO` takes the UTC day of that instant, which is the previous
 * calendar day for the whole morning in MY/SG — so a board cell on 1 Feb cannot find the row and
 * Save inserts a second person-day against `unique(employment_id, work_date)`.
 */
export function workDateCalendarKey(value: string | Date): string {
	if (typeof value === 'string' && isCalendarDate(value)) return value;
	const instant = typeof value === 'string' ? new Date(value) : value;
	if (Number.isNaN(instant.getTime())) {
		throw new Error(`"${String(value)}" is not a work date.`);
	}
	return calendarDateInTimeZone(instant, PAYROLL_TIME_ZONE);
}

/** Inclusive start-of-day instants for a `YYYY-MM` work-date query in the payroll zone. */
export function monthWorkDateInstantBounds(month: string): {
	readonly start: string;
	readonly end: string;
} {
	const lastDay = String(daysInMonth(month)).padStart(2, '0');
	return {
		start: startOfDayInstant(`${month}-01`, PAYROLL_TIME_ZONE),
		end: startOfDayInstant(`${month}-${lastDay}`, PAYROLL_TIME_ZONE)
	};
}
