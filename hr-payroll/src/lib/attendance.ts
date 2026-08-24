import { Schema } from 'effect';
import type { InstantRangeValue as WorkedInterval } from '@norbital-ai/bolt/authoring';

/** The one vocabulary these helpers read and the summaries they feed, all schema-owned. */
const attendanceStateSchema = Schema.Literals(['OPEN', 'COMPLETE', 'INVALID']);
type AttendanceState = Schema.Schema.Type<typeof attendanceStateSchema>;

/**
 * A `worked_intervals` value read from storage is already decoded against the strict worked-
 * intervals schema at the write boundary, so these helpers read the typed intervals directly.
 */
export function attendanceState(value: readonly WorkedInterval[]): AttendanceState {
	return value.some((interval) => interval.end == null) ? 'OPEN' : 'COMPLETE';
}

export function attendanceBoundary(
	value: readonly WorkedInterval[],
	boundary: 'FIRST' | 'LAST'
): string | null {
	if (value.length === 0) return null;
	if (boundary === 'FIRST') return value[0]!.start;
	return value.at(-1)?.end ?? null;
}

export function workedMinutes(
	value: readonly WorkedInterval[],
	breakMinutes: number | null | undefined
): number | null {
	let gross = 0;
	for (const interval of value) {
		if (interval.end == null) return null;
		gross += (Date.parse(interval.end) - Date.parse(interval.start)) / 60_000;
	}
	return Math.max(0, gross - Number(breakMinutes ?? 0));
}
