/**
 * Date-only arithmetic for the payroll engine.
 *
 * Every date the engine reasons about is a calendar day, never an instant: an attendance window,
 * a work date, an employment range. They are handled as `YYYY-MM-DD` strings anchored to UTC, so
 * that no host timezone can move a day across a period boundary. `effective_range` columns hold
 * ISO instants and are resolved in the business timezone before comparison.
 */

import { Number as EffectNumber, Schema } from 'effect';
import { calendarDay, dateKey as calendarDateKey } from '../../../lib/iso-day.js';
import { decodeNumber } from '@norbital-ai/std/json';

/** A calendar day, `YYYY-MM-DD`. */
export type IsoDate = Schema.Schema.Type<typeof calendarDay>;

const DAY_MS = 86_400_000;

/** Resolve a stored instant or fixed date to its payroll calendar day. */
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
	return decodeNumber(date.slice(8, 10));
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
	return dayString(dayNumber(date) + days);
}

/** Number of calendar days in the month a date falls in. */
export function monthDays(date: IsoDate): number {
	const year = decodeNumber(date.slice(0, 4));
	const monthIndex = decodeNumber(date.slice(5, 7)) - 1;
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
	const first = dayNumber(start);
	const last = dayNumber(end);
	const days: IsoDate[] = [];
	for (let day = first; day <= last; day += 1) days.push(dayString(day));
	return days;
}

/**
 * Integer day arithmetic: the leave year is enumerated day by day per employment, and the
 * `Date.parse` + `new Date` + `toISOString` round trip behind every step dominated that loop.
 * Days-from-civil / civil-from-days (Hinnant), days since 1970-01-01, proleptic Gregorian —
 * the same calendar `Date.UTC` computes over for in-range days.
 */
function dayNumber(date: IsoDate): number {
	const year = decodeNumber(date.slice(0, 4));
	const month = decodeNumber(date.slice(5, 7));
	const day = decodeNumber(date.slice(8, 10));
	const shiftedYear = month <= 2 ? year - 1 : year;
	const era = Math.floor((shiftedYear >= 0 ? shiftedYear : shiftedYear - 399) / 400);
	const yearOfEra = shiftedYear - era * 400;
	const monthIndex = month > 2 ? month - 3 : month + 9;
	const dayOfYear = Math.floor((153 * monthIndex + 2) / 5) + day - 1;
	const dayOfEra =
		yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
	return era * 146097 + dayOfEra - 719468;
}

function dayString(days: number): IsoDate {
	const shifted = days + 719468;
	const era = Math.floor((shifted >= 0 ? shifted : shifted - 146096) / 146097);
	const dayOfEra = shifted - era * 146097;
	const yearOfEra = Math.floor(
		(dayOfEra -
			Math.floor(dayOfEra / 1460) +
			Math.floor(dayOfEra / 36524) -
			Math.floor(dayOfEra / 146096)) /
			365
	);
	const year = yearOfEra + era * 400;
	const dayOfYear =
		dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
	const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
	const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
	const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
	const fullYear = month <= 2 ? year + 1 : year;
	return (
		`${String(fullYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-` +
		`${String(day).padStart(2, '0')}`
	);
}

/**
 * Completed calendar months between two days, anniversary-exact: someone hired on 14 July 2024 has
 * 24 completed months on 14 July 2026 and 23 on the 13th (decision L4).
 */
export function completedMonths(start: IsoDate, end: IsoDate): number {
	const startYear = decodeNumber(start.slice(0, 4));
	const startMonth = decodeNumber(start.slice(5, 7));
	const endYear = decodeNumber(end.slice(0, 4));
	const endMonth = decodeNumber(end.slice(5, 7));
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

/**
 * The grammar of a payroll run's period.
 *
 * A monthly company runs months, written `YYYY-MM`. A semi-monthly company runs halves, written
 * `YYYY-MM-1` (the 1st to the 15th, paid on the 15th) and `YYYY-MM-2` (the 16th to the month end,
 * paid at the month end). The suffix is part of the period, not a separate column, because every
 * rule that orders runs compares the period text: `2026-02-1 < 2026-02-2 < 2026-03-1` is the
 * chronological order, so the previous-run-paid rule and the year-to-date filter read the new
 * grammar unchanged.
 */
const RUN_PERIOD = /^\d{4}-(0[1-9]|1[0-2])(-[12])?$/;

/** The `YYYY-MM` a run period belongs to; the whole of it for a monthly period. */
export function periodMonth(period: string): string {
	if (!RUN_PERIOD.test(period))
		throw new Error(
			`Payroll period must be YYYY-MM or YYYY-MM-1 / YYYY-MM-2, received "${period}".`
		);
	return period.slice(0, 7);
}

/** Which half of the month a run period names, or `null` for a whole month. */
export function periodHalf(period: string): 1 | 2 | null {
	periodMonth(period);
	return period.length === 7 ? null : period.endsWith('1') ? 1 : 2;
}

/** First and last calendar day of a `YYYY-MM` month. A run period goes through `periodMonth`. */
export function monthBounds(period: string): { start: IsoDate; end: IsoDate } {
	if (!/^\d{4}-\d{2}$/.test(period))
		throw new Error(`Period must be YYYY-MM, received "${period}".`);
	const year = decodeNumber(period.slice(0, 4));
	const monthIndex = decodeNumber(period.slice(5, 7)) - 1;
	return { start: iso(utc(year, monthIndex, 1)), end: iso(utc(year, monthIndex + 1, 0)) };
}

/** The period `offset` months after `period`, in the same grammar: a half stays the same half. */
export function shiftPeriod(period: string, offset: number): string {
	const year = decodeNumber(period.slice(0, 4));
	const monthIndex = decodeNumber(period.slice(5, 7)) - 1 + offset;
	return `${iso(utc(year, monthIndex, 1)).slice(0, 7)}${period.slice(7)}`;
}
