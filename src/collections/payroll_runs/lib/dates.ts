/**
 * Date-only arithmetic for the payroll engine.
 *
 * Every date the engine reasons about is a calendar day, never an instant: an attendance window,
 * a work date, an employment range. They are handled as `YYYY-MM-DD` strings anchored to UTC, so
 * that no host timezone can move a day across a period boundary. `effective_range` columns hold
 * ISO instants and are sliced to ten characters before comparison.
 */

import { Number as EffectNumber, Schema } from 'effect';
import { calendarDay, dateKey as calendarDateKey } from '../../../lib/iso-day.js';

/** A calendar day, `YYYY-MM-DD`. */
export type IsoDate = Schema.Schema.Type<typeof calendarDay>;

const DAY_MS = 86_400_000;

/**
 * Narrow any stored date-ish value to its calendar day.
 *
 * A `date` column carries no time zone, and it reaches the engine as the `YYYY-MM-DD` text the
 * driver read off the wire — which is the only representation of a calendar day that no host can
 * move. Slicing it is therefore the whole conversion, and it is exact.
 *
 * Authored instants are always ISO strings. Day precision is presentation metadata, so the first
 * ten characters are stable without consulting the host's local time zone.
 */
export function dateKey(value: string | null | undefined): IsoDate | null {
	const key = calendarDateKey(value);
	return key === '' ? null : key;
}

/** Same as `dateKey`, for a value that must be present. */
export function requiredDateKey(value: string, what: string): IsoDate {
	const key = dateKey(value);
	if (key == null || key.length !== 10) throw new Error(`${what} is not a calendar date.`);
	return key;
}

function utc(year: number, monthIndex: number, day: number): Date {
	return new Date(Date.UTC(year, monthIndex, day));
}

function iso(value: Date): IsoDate {
	return value.toISOString().slice(0, 10);
}

/** The `YYYY-MM` a day belongs to. */
export function monthKey(date: IsoDate): string {
	return date.slice(0, 7);
}

/** Day of month, 1-31. */
export function dayOfMonth(date: IsoDate): number {
	return Number(date.slice(8, 10));
}

/**
 * The `day`th day of a month, clamped to the month's length — so a cutoff of 31 resolves to the
 * 28th or 29th in February rather than wrapping into March. `monthIndex` may be out of range and
 * rolls into the neighbouring year, which is how the previous month of January is addressed.
 */
export function monthDay(year: number, monthIndex: number, day: number): IsoDate {
	const lastDay = utc(year, monthIndex + 1, 0).getUTCDate();
	return iso(utc(year, monthIndex, EffectNumber.clamp({ minimum: 1, maximum: lastDay })(day)));
}

export function addDays(date: IsoDate, days: number): IsoDate {
	return iso(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS));
}

/** Number of calendar days in the month a date falls in. */
export function monthDays(date: IsoDate): number {
	const year = Number(date.slice(0, 4));
	const monthIndex = Number(date.slice(5, 7)) - 1;
	return utc(year, monthIndex + 1, 0).getUTCDate();
}

/** Days from `start` to `end` counting both ends; 1 when they are the same day. */
export function inclusiveDays(start: IsoDate, end: IsoDate): number {
	const span = Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`);
	return Math.floor(span / DAY_MS) + 1;
}

/** Every calendar day in `[start, end]`. */
export function daysBetween(start: IsoDate, end: IsoDate): IsoDate[] {
	if (end < start) return [];
	const days: IsoDate[] = [];
	for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
	return days;
}

/**
 * Completed calendar months between two days, anniversary-exact: someone hired on 14 July 2024 has
 * 24 completed months on 14 July 2026 and 23 on the 13th (decision L4).
 */
export function completedMonths(start: IsoDate, end: IsoDate): number {
	const startYear = Number(start.slice(0, 4));
	const startMonth = Number(start.slice(5, 7));
	const endYear = Number(end.slice(0, 4));
	const endMonth = Number(end.slice(5, 7));
	let months = (endYear - startYear) * 12 + (endMonth - startMonth);
	if (dayOfMonth(end) < dayOfMonth(start)) months -= 1;
	return Math.max(0, months);
}

/** Whole years between two days, on the same anniversary-exact basis. */
export function completedYears(start: IsoDate, end: IsoDate): number {
	return Math.floor(completedMonths(start, end) / 12);
}

/** The overlap of two inclusive day ranges, or `null` when they are disjoint. */
export function intersectDays(
	a: { start: IsoDate; end: IsoDate },
	b: { start: IsoDate; end: IsoDate }
): { start: IsoDate; end: IsoDate } | null {
	const start = a.start > b.start ? a.start : b.start;
	const end = a.end < b.end ? a.end : b.end;
	return start > end ? null : { start, end };
}

/** First and last calendar day of a `YYYY-MM` period. */
export function monthBounds(period: string): { start: IsoDate; end: IsoDate } {
	if (!/^\d{4}-\d{2}$/.test(period))
		throw new Error(`Period must be YYYY-MM, received "${period}".`);
	const year = Number(period.slice(0, 4));
	const monthIndex = Number(period.slice(5, 7)) - 1;
	return { start: iso(utc(year, monthIndex, 1)), end: iso(utc(year, monthIndex + 1, 0)) };
}

/** The `YYYY-MM` `offset` months after `period`. */
export function shiftPeriod(period: string, offset: number): string {
	const year = Number(period.slice(0, 4));
	const monthIndex = Number(period.slice(5, 7)) - 1 + offset;
	return iso(utc(year, monthIndex, 1)).slice(0, 7);
}
