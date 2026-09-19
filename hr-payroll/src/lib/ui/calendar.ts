/**
 * Calendar helpers used by the app pages for *display* only.
 *
 * Nothing here decides payroll: the period window, cutoff handling and pay-date shifting that a
 * run is actually built with belong to the payroll engine and reach the UI as stored
 * `payroll_runs.pay_date` / `attendance_from` / `attendance_to` columns. These functions only put
 * a period's pay date (its last day) on a calendar so an operator can see which cycles are still
 * open.
 */

import { Number as EffectNumber, Result } from 'effect';
import { formatDateISO, isCalendarDate } from '@norbital-ai/std/date';
import { decodeNumber } from '@norbital-ai/std/json';
import { addDays, monthDays, shiftPeriod } from '../../collections/payroll_runs/lib/dates.js';
import { weeklyInstalments } from '../../collections/payroll_runs/lib/period.js';

import type { CollectionInitialFilter } from '@norbital-ai/ui/collection-surface';

import { PAYROLL_TIME_ZONE, calendarDateInTimeZone, dayInstant } from '../iso-day.js';
export { PAYROLL_TIME_ZONE, calendarDateInTimeZone } from '../iso-day.js';

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
 * every day it selects yesterday's rate row, so a transform could price against a different day
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
 * The instant at which `calendarDate` begins in `timeZone`.
 *
 * This is wall-clock arithmetic — the roster's minute offsets and the viewer-zone picker adapters
 * below anchor on it. It is not how a day is *stored*: a day-precision column and a day-precision
 * range bound hold the canonical UTC day (`dayInstant`), whatever zone the business runs in.
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
 * The closed end of an effective range on `calendarDate`: the last millisecond of that day in
 * the payroll zone, `2026-06-30T15:59:59.999Z` for 30 June in Kuala Lumpur — the seed bank's
 * convention. A range's start is the day's stored form (`dayInstant`). `contains_date` compares
 * the bound texts, so an end at the zone's *start* of the last day (`T16:00:00.000Z` of the day
 * before) put every leaver out of force on their last day in every list, while the engine, which
 * resolves the bound to a day, still paid it.
 */
export function endOfDayInstant(calendarDate: string): string {
	return new Date(
		Date.parse(startOfDayInstant(addDays(calendarDate, 1), PAYROLL_TIME_ZONE)) - 1
	).toISOString();
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
interface DayPickerInstantRange {
	readonly start: string;
	readonly end?: string;
}

/** A calendar day shifted by whole days without involving the browser's local timezone. */
export function shiftDayKey(day: string, days: number): string {
	return addDays(day, Math.trunc(days));
}

/** `YYYY-MM` offset by whole months. */
export function shiftMonthKey(period: string, months: number): string {
	return shiftPeriod(period, months);
}

/** Number of days in the `YYYY-MM` month. */
export function daysInMonth(period: string): number {
	return monthDays(`${period}-01`);
}

/**
 * A run period in the company's grammar: `YYYY-MM` at a monthly company, `YYYY-MM-1` (the 1st to
 * the 15th) or `YYYY-MM-2` (the 16th to the month end) at a semi-monthly one. The engine's
 * `periodMonth` / `periodHalf` are the same grammar; these read it for the screens.
 */
export function periodMonthOf(period: string): string {
	return period.slice(0, 7);
}

/** The instalment a period names — a half (1, 2) or a week (1–5) — or `null` for a whole month. */
export function periodHalfOf(period: string): number | null {
	return period.length === 7 ? null : Number(period.slice(8));
}

/** The first and last day of the month a period pays for: `1–15`, `16–28`, or the whole month. */
export function periodDayRange(period: string): { readonly from: number; readonly to: number } {
	const last = daysInMonth(periodMonthOf(period));
	switch (periodHalfOf(period)) {
		case 1:
			return { from: 1, to: 15 };
		case 2:
			return { from: 16, to: last };
		default:
			return { from: 1, to: last };
	}
}

/**
 * A selected period restated in the company's grammar: a semi-monthly company reads a bare month
 * as the half `today` falls in, a monthly company drops a half suffix. The board and its picker
 * follow the entity's pay cycle, not the calendar month.
 */
export function periodInCompanyGrammar(
	period: string,
	payFrequency: string | undefined,
	today: string
): string {
	const month = periodMonthOf(period);
	if (payFrequency === 'WEEKLY') {
		const weeks = weeklyInstalments(month);
		const named = periodHalfOf(period);
		if (named != null && named <= weeks.length) return period;
		// The week today falls in, where today is in the month; else the month's first week.
		const current = weeks.findIndex(
			(week) => week.salary.start <= today && today <= week.salary.end
		);
		return `${month}-${current >= 0 ? current + 1 : 1}`;
	}
	if (payFrequency !== 'SEMI_MONTHLY') return month;
	if (periodHalfOf(period) != null && (periodHalfOf(period) ?? 0) <= 2) return period;
	return `${month}-${Number(today.slice(8, 10)) <= 15 ? 1 : 2}`;
}

/**
 * A `start`..`end` day window as the instants a day-precision column is filtered by: the stored
 * form of `start`, and of the day after `end` as the exclusive bound. A bare `YYYY-MM-DD` bound is
 * cast in the querying session's own zone — midnight Singapore here, midnight UTC on a deployed
 * host — and drops the boundary day: a 31 January row stored at UTC midnight is past
 * `lte: '2026-01-31'` on a UTC+8 host. Every day column is stored as its UTC midnight
 * (`dayInstant`), so these bounds are exact.
 */
export function dayWindowInstantBounds(window: { readonly start: string; readonly end: string }): {
	readonly start: string;
	readonly end: string;
} {
	return { start: dayInstant(window.start), end: dayInstant(addDays(window.end, 1)) };
}

/**
 * The periods a company runs over a list of months: the months themselves, or both halves of each
 * for a semi-monthly company, in chronological order.
 */
export function companyPeriods(months: readonly string[], payFrequency: string): string[] {
	if (payFrequency === 'WEEKLY')
		return months.flatMap((month) =>
			weeklyInstalments(month).map((week) => `${month}-${week.sequence}`)
		);
	if (payFrequency !== 'SEMI_MONTHLY') return [...months];
	return months.flatMap((month) => [`${month}-1`, `${month}-2`]);
}

/**
 * The day a period pays: the 15th for a first half, a week's Sunday, otherwise its last calendar
 * day. The compliance month is the cutoff month.
 */
export function payDateFor(period: string, payFrequency?: string): string {
	const month = periodMonthOf(period);
	if (payFrequency === 'WEEKLY') {
		const week = weeklyInstalments(month)[(periodHalfOf(period) ?? 1) - 1];
		if (week != null) return week.payDate;
	}
	return `${month}-${String(periodDayRange(period).to).padStart(2, '0')}`;
}

/** The days a weekly period pays for, `null` where the period is not a week of a weekly company. */
export function weekOf(
	period: string,
	payFrequency: string | undefined
): { readonly start: string; readonly end: string } | null {
	if (payFrequency !== 'WEEKLY') return null;
	return weeklyInstalments(periodMonthOf(period))[(periodHalfOf(period) ?? 1) - 1]?.salary ?? null;
}

/** Whole days from `from` to `to`, negative when `to` is in the past. */
export function daysBetweenKeys(from: string, to: string): number {
	return Math.ceil(
		(Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000
	);
}

/** The `YYYY-MM` periods spanning `count` months, ending `ahead` months after the current month. */
export function periodWindow(count: number, ahead: number): string[] {
	const current = todayKey().slice(0, 7);
	return Array.from({ length: count }, (_value, index) =>
		shiftMonthKey(current, ahead - count + 1 + index)
	);
}

/**
 * "Now", as the instant a `contains_date` filter wants: today's stored form. A range starting
 * today starts at this very instant, so the row is in force on its first day here as it is in the
 * engine.
 */
export function todayInstant(): string {
	return dayInstant(todayKey());
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

/** Inclusive stored instants of a `YYYY-MM` month's first and last day, for a day-column query. */
export function monthWorkDateInstantBounds(month: string): {
	readonly start: string;
	readonly end: string;
} {
	const lastDay = String(daysInMonth(month)).padStart(2, '0');
	return { start: dayInstant(`${month}-01`), end: dayInstant(`${month}-${lastDay}`) };
}
