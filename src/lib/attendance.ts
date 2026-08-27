import { Schema } from 'effect';
import type { InstantRangeValue as WorkedInterval } from '@norbital-ai/bolt/authoring';

/** The one vocabulary these helpers read and the summaries they feed, all schema-owned. */
const attendanceStateSchema = Schema.Literals(['OPEN', 'COMPLETE', 'INVALID']);
type AttendanceState = Schema.Schema.Type<typeof attendanceStateSchema>;

/**
 * A `worked_intervals` value read from storage is already decoded against the strict worked-
 * intervals schema at the write boundary, so these helpers read the typed intervals directly.
 */
/**
 * `null` and `[]` are different facts on a work day and must not be conflated.
 *
 * A merged `work_days` row carries a plan, attendance, or both. `worked_intervals` NULL means no
 * attendance was ever recorded — the day is a plan and nothing else. `[]` means the day WAS read and
 * nothing was worked, which is a settled statement payroll prices at zero. Collapsing the first into
 * the second with `?? []` would report every unrecorded day as complete.
 */
export function attendanceState(
	value: readonly WorkedInterval[] | null | undefined
): AttendanceState {
	if (value == null) return 'OPEN';
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
