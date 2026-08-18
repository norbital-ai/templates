import type { WorkedInterval } from '../custom-types/worked_intervals/+definition.js';

export type AttendanceState = 'OPEN' | 'COMPLETE' | 'INVALID';

/**
 * A `worked_intervals` value read from storage is already decoded against the strict worked-
 * intervals schema at the write boundary, so these helpers read the typed intervals directly.
 */
export function attendanceState(value: readonly WorkedInterval[]): AttendanceState {
	return value.some((interval) => interval.end_at == null) ? 'OPEN' : 'COMPLETE';
}

/**
 * Reads a stored `worked_intervals` value back into typed intervals.
 *
 * A table cell hands its value as `unknown` — the column carries no element type — so the UI needs
 * one place that decides whether a value really is a list of intervals. Returns null rather than
 * throwing: a render pass reports malformed attendance as INVALID, it does not fail the page.
 */
export function readWorkedIntervals(value: unknown): readonly WorkedInterval[] | null {
	if (!Array.isArray(value)) return null;
	const intervals: WorkedInterval[] = [];
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null) return null;
		const startAt = Reflect.get(entry, 'start_at');
		const endAt = Reflect.get(entry, 'end_at');
		if (typeof startAt !== 'string') return null;
		if (endAt != null && typeof endAt !== 'string') return null;
		intervals.push({ start_at: startAt, end_at: endAt ?? null });
	}
	return intervals;
}

export function attendanceBoundary(
	value: readonly WorkedInterval[],
	boundary: 'FIRST' | 'LAST'
): string | null {
	if (value.length === 0) return null;
	if (boundary === 'FIRST') return value[0]!.start_at;
	return value.at(-1)?.end_at ?? null;
}

export function workedMinutes(
	value: readonly WorkedInterval[],
	breakMinutes: number | null | undefined
): number | null {
	let gross = 0;
	for (const interval of value) {
		if (interval.end_at == null) return null;
		gross += (Date.parse(interval.end_at) - Date.parse(interval.start_at)) / 60_000;
	}
	return Math.max(0, gross - Number(breakMinutes ?? 0));
}
