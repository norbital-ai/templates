import { workedIntervalsSchema } from '../custom-types/worked_intervals/+definition.js';

export type AttendanceState = 'OPEN' | 'COMPLETE' | 'INVALID';

export function attendanceState(value: unknown): AttendanceState {
	const parsed = workedIntervalsSchema.safeParse(value);
	if (!parsed.success) return 'INVALID';
	return parsed.data.some((interval) => interval.end_at == null) ? 'OPEN' : 'COMPLETE';
}

export function attendanceBoundary(value: unknown, boundary: 'FIRST' | 'LAST'): string | null {
	const parsed = workedIntervalsSchema.safeParse(value);
	if (!parsed.success || parsed.data.length === 0) return null;
	if (boundary === 'FIRST') return parsed.data[0]!.start_at;
	return parsed.data.at(-1)?.end_at ?? null;
}

export function workedMinutes(value: unknown, breakMinutes: unknown): number | null {
	const parsed = workedIntervalsSchema.safeParse(value);
	if (!parsed.success || parsed.data.some((interval) => interval.end_at == null)) return null;
	const gross = parsed.data.reduce(
		(total, interval) =>
			total + (Date.parse(interval.end_at!) - Date.parse(interval.start_at)) / 60_000,
		0
	);
	return Math.max(0, gross - Number(breakMinutes ?? 0));
}
