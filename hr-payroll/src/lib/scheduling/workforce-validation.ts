/** Clock-overlap checks for explicit assignments. */

import { decodeNumber } from '@norbital-ai/std/json';
import { clockMinutes } from './roster-code.js';

type Designation = 'WORK' | 'REST' | 'OFF';

type ValidationShift = {
	readonly code: string;
	readonly start_time: string;
	readonly end_time: string;
	readonly break_minutes: number;
};

export type ValidationDay = {
	readonly employment_id: string;
	readonly work_date: string;
	readonly designation: Designation | null;
	readonly shift: ValidationShift | null;
};

type WorkShiftOverlap = {
	readonly employment_id: string;
	readonly first: ValidationDay;
	readonly second: ValidationDay;
};

function dayMinutes(date: string): number {
	const parsed = Date.parse(`${date}T00:00:00.000Z`);
	if (Number.isNaN(parsed)) throw new Error(`Not a calendar date: "${date}".`);
	return parsed / 60_000;
}

/**
 * Find clock collisions on the real timeline, including an overnight shift colliding with the
 * following day's early shift. Touching end/start boundaries are allowed; overlapping minutes are
 * not. The function is shared by authored transforms, the draft UI and the publication gate.
 */
export function overlappingWorkShifts(days: readonly ValidationDay[]): WorkShiftOverlap[] {
	const byEmployment = Map.groupBy(
		days.flatMap((day) => {
			if (day.designation !== 'WORK' || day.shift == null) return [];
			const base = dayMinutes(day.work_date);
			const startClock = clockMinutes(day.shift.start_time);
			const rawEnd = clockMinutes(day.shift.end_time);
			const endClock = rawEnd <= startClock ? rawEnd + 1440 : rawEnd;
			return [{ day, start: base + startClock, end: base + endClock }];
		}),
		(interval) => interval.day.employment_id
	);

	const overlaps: WorkShiftOverlap[] = [];
	for (const [employmentId, intervals] of byEmployment) {
		intervals.sort((left, right) => left.start - right.start || left.end - right.end);
		let furthest: (typeof intervals)[number] | null = null;
		for (const interval of intervals) {
			if (furthest != null && interval.start < furthest.end) {
				overlaps.push({ employment_id: employmentId, first: furthest.day, second: interval.day });
			}
			if (furthest == null || interval.end > furthest.end) furthest = interval;
		}
	}
	return overlaps;
}
