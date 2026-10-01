import { Schema } from 'effect';
import * as Predicate from 'effect/Predicate';

/** The workspace business zone owns payroll calendar dates, independently of the host. */
export const PAYROLL_TIME_ZONE = 'Asia/Kuala_Lumpur';
const dayFormat = (timeZone: string) =>
	new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
// made at first use: an Intl object at module top level refuses the guest snapshot (V8 cannot serialize it)
let payrollDateFormat: Intl.DateTimeFormat | undefined;

export function calendarDateInTimeZone(value: Date, timeZone: string): string {
	const formatter =
		timeZone === PAYROLL_TIME_ZONE
			? (payrollDateFormat ??= dayFormat(timeZone))
			: dayFormat(timeZone);
	const parts = formatter.formatToParts(value);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((entry) => entry.type === type)?.value ?? '';
	return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Resolve stored instants in the business zone; fixed calendar-day strings retain their day. */
export function dateKey(value: string | null | undefined): string {
	if (value == null || value === '') return '';
	const known = dayCache.get(value);
	if (known !== undefined) return known;
	const resolved = resolveDay(value);
	if (dayCache.size > 50_000) dayCache.clear();
	dayCache.set(value, resolved);
	return resolved;
}

/**
 * One parse per distinct input: a payroll asks for the day of the same range bounds, holidays
 * and employment dates thousands of times per run, and the `Date` + `Intl` round trip behind
 * each uncached call dominated build CPU. Bounded (a run's distinct inputs are its calendar,
 * not its row count); the clear is a throttle, not a wraparound — dates recur, so steady state
 * stays cached.
 */
const dayCache = new Map<string, string>();

function resolveDay(value: string): string {
	if (isCalendarDate(value)) return value;
	if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return '';
	const instant = new Date(value);
	if (!Number.isFinite(instant.getTime())) return '';
	const day = calendarDateInTimeZone(instant, PAYROLL_TIME_ZONE);
	// Existing far-future open-range fixtures must keep a four-digit sortable endpoint.
	return day.length === 10 ? day : value.slice(0, 10);
}

/**
 * A calendar day in the payroll timezone, as `2026-04-02`.
 *
 * The pattern fixes the grammar and the filter fixes the calendar, for the same reason the
 * platform's instant schema pairs them: the pattern alone admits `2026-02-30`, which `Date` rolls
 * forward to March, so a day that does not exist would be recorded as if it did.
 */
export const calendarDay = Schema.String.check(
	Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/),
	Schema.makeFilter(
		(value: string) =>
			new Date(`${value}T00:00:00Z`).toISOString().startsWith(value) ||
			'must name a day that exists',
		{ title: 'realCalendarDay' }
	)
);

/**
 * Whether a record id is a settled UUID. A live answer overlays a write still in flight as a row
 * whose id is its idempotency key with a piece index (`<key>:0`); a dependent `id in [...]` query
 * built from such rows is refused by Postgres as a malformed uuid and takes every live query on
 * the page down with it, so ids are filtered through this before they are asked about.
 */
export const isSettledId = (value: string): boolean =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * The stored form of a day-precision instant: the UTC midnight of the calendar day.
 *
 * A `precision: 'day'` column is a `timestamptz`, and a bare `2026-01-31` handed to it is read at
 * the database session's zone — midnight Singapore on this machine, midnight UTC on a deployed
 * host — so the same write lands on two instants. The platform's pickers and the seed loader both
 * store the UTC day, and every SQL reader (`bolt_instant`, the list renderers) takes the date
 * prefix; a value written any other way prints a day early there and escapes the day's unique
 * key. Bounds are instants for the same reason: `lte '2026-01-31'` is midnight Singapore, which is
 * before the day's own rows. `dateKey` reads the result back as the same business day.
 */
export function dayInstant(day: string): string {
	if (!isCalendarDate(day)) throw new Error(`"${day}" is not a YYYY-MM-DD calendar day.`);
	return `${day}T00:00:00.000Z`;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC_ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;

/** A real calendar day `YYYY-MM-DD`. */
export function isCalendarDate(value: string): boolean {
	if (!CALENDAR_DATE.test(value)) return false;
	const day = new Date(`${value}T00:00:00.000Z`);
	// 2026-13-01 is an Invalid Date, whose toISOString throws
	return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/** A 24-hour clock time `HH:MM`. */
export const isClockTime = (value: string): boolean => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

/** A UTC ISO instant `YYYY-MM-DDTHH:MM:SS(.sss)Z` whose parts are in range. */
export function isUtcIsoInstant(value: string): boolean {
	const match = UTC_ISO_INSTANT.exec(value);
	return (
		match != null &&
		isCalendarDate(match[1]!) &&
		Number.parseInt(match[2]!, 10) <= 23 &&
		Number.parseInt(match[3]!, 10) <= 59 &&
		Number.parseInt(match[4]!, 10) <= 59
	);
}

/** The UTC calendar day `YYYY-MM-DD` of a stored instant or calendar string. */
export function formatDateISO(value: string | Date): string {
	if (Predicate.isString(value) && isCalendarDate(value)) return value;
	const date = Predicate.isString(value) ? new Date(value) : value;
	if (Number.isNaN(date.getTime())) throw new Error(`Invalid UTC instant: ${String(value)}`);
	return date.toISOString().slice(0, 10);
}
