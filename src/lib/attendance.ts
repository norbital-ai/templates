import type { InstantRangeValue as WorkedInterval } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';

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
	return Math.max(0, gross - decodeNumber(breakMinutes ?? 0));
}
