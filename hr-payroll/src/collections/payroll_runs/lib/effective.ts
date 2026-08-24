/**
 * Reading effective-dated configuration.
 *
 * Every configuration collection is a history: a change is an end-date plus a successor row, never
 * an update in place, and a Postgres exclusion constraint guarantees no two rows for the same key
 * overlap. So a lookup on a date returns at most one row *structurally* — these helpers exist to
 * make that fact usable, not to resolve ambiguity that cannot arise.
 */

import { Option, Schema } from 'effect';
import type { IsoDate } from './dates.js';

/** Payroll calendar zone. Kept here so the engine never imports `lib/ui`. */
const PAYROLL_TIME_ZONE = 'Asia/Kuala_Lumpur';

const payrollDateFormat = new Intl.DateTimeFormat('en', {
	timeZone: PAYROLL_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/**
 * The stored JSONB shape of a `custom('instant_range', { precision: 'day' })` column, read leniently.
 *
 * The write boundary validates both bounds as `UTC_INSTANT` values, and this read shape also
 * accepts the legacy bounded-optional form so an older row is still readable as the open-ended
 * statement it was written to be. `end` of `null` (or an empty string) is open-ended forever.
 */
const storedRangeReadSchema = Schema.Struct({
	start: Schema.optionalKey(Schema.String),
	end: Schema.optionalKey(Schema.NullOr(Schema.String))
});

/** A `custom('instant_range', { precision: 'day' })` column as the engine reads it; `end` of `null` is open-ended. */
export const StoredRangeSchema = Schema.Struct({
	start: Schema.String,
	end: Schema.NullOr(Schema.String)
});
export type StoredRange = Schema.Schema.Type<typeof StoredRangeSchema>;

/** Decode one stored range: anything that is not a legal pair of strings is `null`, never an error. */
export function readRange(value: unknown): StoredRange | null {
	const parsed = Option.getOrNull(Schema.decodeUnknownOption(storedRangeReadSchema)(value));
	if (parsed == null) return null;
	const start = parsed.start;
	if (start == null || start === '') return null;
	return {
		start,
		end: parsed.end != null && parsed.end !== '' ? parsed.end : null
	};
}

/**
 * Calendar day of a `custom('instant_range', { precision: 'day' })` instant in the payroll timezone.
 *
 * UTC `.slice(0, 10)` is forbidden: a KL midnight bound is the previous UTC day, so the first
 * local day of a term would miss. Far-future seeds such as `9999-12-31T23:59:59.999Z` convert to
 * a 5-digit year in KL; those fall back to the UTC day so lexicographic `YYYY-MM-DD` comparison
 * still covers every real payroll date.
 */
function calendarDateInTimeZone(value: Date, timeZone: string): string {
	const formatter =
		timeZone === PAYROLL_TIME_ZONE
			? payrollDateFormat
			: new Intl.DateTimeFormat('en', {
					timeZone,
					year: 'numeric',
					month: '2-digit',
					day: '2-digit'
				});
	const parts = formatter.formatToParts(value);
	const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? '';
	return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}

function rangeBoundDay(instant: string): IsoDate {
	const at = new Date(instant);
	if (Number.isNaN(at.getTime())) return instant.slice(0, 10);
	const converted = calendarDateInTimeZone(at, PAYROLL_TIME_ZONE);
	return converted.length === 10 ? converted : instant.slice(0, 10);
}

/** Whether an `effective_range` covers a calendar day. Both ends inclusive. */
export function coversDate(range: unknown, date: IsoDate): boolean {
	// A single day is the degenerate window, so there is one implementation of the comparison.
	return overlapsRange(range, date, date);
}

/** Whether an `effective_range` touches any day of `[start, end]`. */
export function overlapsRange(range: unknown, start: IsoDate, end: IsoDate): boolean {
	const parsed = readRange(range);
	if (!parsed) return false;
	if (rangeBoundDay(parsed.start) > end) return false;
	return parsed.end == null || rangeBoundDay(parsed.end) >= start;
}

/** The one member `effectiveOn` and `effectiveWithin` depend on: a row with an effective range. */
const DatedSchema = Schema.Struct({ effective_range: Schema.optionalKey(Schema.Unknown) });
type Dated = Schema.Schema.Type<typeof DatedSchema>;

/** The single row effective on a day, or `undefined`. */
export function effectiveOn<T extends Dated>(rows: readonly T[], date: IsoDate): T | undefined {
	return rows.find((row) => coversDate(row.effective_range, date));
}

/** Every row touching `[start, end]`, in effective order. */
export function effectiveWithin<T extends Dated>(
	rows: readonly T[],
	start: IsoDate,
	end: IsoDate
): T[] {
	return rows
		.filter((row) => overlapsRange(row.effective_range, start, end))
		.toSorted((left, right) =>
			String(readRange(left.effective_range)?.start ?? '').localeCompare(
				String(readRange(right.effective_range)?.start ?? '')
			)
		);
}

/** The `[start, end]` days of an effective range clipped into a window. */
export function clipRange(
	range: unknown,
	window: { start: IsoDate; end: IsoDate }
): { start: IsoDate; end: IsoDate } | null {
	const parsed = readRange(range);
	if (!parsed) return null;
	const rangeStart = rangeBoundDay(parsed.start);
	const start = rangeStart > window.start ? rangeStart : window.start;
	const rawEnd = parsed.end == null ? window.end : rangeBoundDay(parsed.end);
	const end = rawEnd < window.end ? rawEnd : window.end;
	return start > end ? null : { start, end };
}

/** Only rows the platform has approved. A null approval stamp means approved on this platform. */
const ApprovableSchema = Schema.Struct({
	approval_id: Schema.optionalKey(Schema.NullOr(Schema.String))
});
type Approvable = Schema.Schema.Type<typeof ApprovableSchema>;

export function live<T extends Approvable>(rows: readonly T[]): T[] {
	return rows.filter((row) => row.approval_id == null);
}
