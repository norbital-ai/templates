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

import { dateKey as rangeBoundDay } from '../../../lib/iso-day.js';

/** A `custom('instant_range', { precision: 'day' })` column as the engine reads it; `end` of `null` is open-ended. */
export const StoredRangeSchema = Schema.Struct({
	start: Schema.String,
	end: Schema.NullOr(Schema.String)
});
export type StoredRange = Schema.Schema.Type<typeof StoredRangeSchema>;

/** Decode one stored range: anything that is not a legal pair of strings is `null`, never an error. */
export function readRange(value: unknown): StoredRange | null {
	const parsed = Option.getOrNull(Schema.decodeUnknownOption(StoredRangeSchema)(value));
	if (parsed == null || parsed.start === '') return null;
	return { start: parsed.start, end: parsed.end === '' ? null : parsed.end };
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

/** Only rows the platform has approved. A null approval stamp means approved on this platform. */
const ApprovableSchema = Schema.Struct({
	approval_id: Schema.optionalKey(Schema.NullOr(Schema.String))
});
type Approvable = Schema.Schema.Type<typeof ApprovableSchema>;

export function live<T extends Approvable>(rows: readonly T[]): T[] {
	return rows.filter((row) => row.approval_id == null);
}
