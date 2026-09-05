/** Clock-overlap checks for explicit assignments. */

import { Schema } from 'effect';
import { decodeNumber } from '@norbital-ai/std/json';

const designationSchema = Schema.Literals(['WORK', 'REST', 'OFF']);
type Designation = Schema.Schema.Type<typeof designationSchema>;

const validationShiftSchema = Schema.Struct({
	code: Schema.String,
	start_time: Schema.String,
	end_time: Schema.String,
	break_minutes: Schema.Number
});
type ValidationShift = Schema.Schema.Type<typeof validationShiftSchema>;

const validationDaySchema = Schema.Struct({
	employment_id: Schema.String,
	work_date: Schema.String,
	designation: Schema.NullOr(designationSchema),
	shift: Schema.NullOr(validationShiftSchema)
});
export type ValidationDay = Schema.Schema.Type<typeof validationDaySchema>;

function clockMinutes(value: string): number {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
	if (match == null) throw new Error(`Not an HH:mm clock time: "${value}".`);
	return decodeNumber(match[1]) * 60 + decodeNumber(match[2]);
}

const workShiftOverlapSchema = Schema.Struct({
	employment_id: Schema.String,
	first: validationDaySchema,
	second: validationDaySchema
});
type WorkShiftOverlap = Schema.Schema.Type<typeof workShiftOverlapSchema>;

function dayMinutes(date: string): number {
	const parsed = Date.parse(`${date}T00:00:00.000Z`);
	if (Number.isNaN(parsed)) throw new Error(`Not a calendar date: "${date}".`);
	return parsed / 60_000;
}

/**
 * Find clock collisions on the real timeline, including an overnight shift colliding with the
 * following day's early shift. Touching end/start boundaries are allowed; overlapping minutes are
 * not. The function is shared by authored hooks, the draft UI and the publication gate.
 */
export function overlappingWorkShifts(days: readonly ValidationDay[]): WorkShiftOverlap[] {
	const byEmployment = new Map<string, { day: ValidationDay; start: number; end: number }[]>();
	for (const day of days) {
		if (day.designation !== 'WORK' || day.shift == null) continue;
		const base = dayMinutes(day.work_date);
		const startClock = clockMinutes(day.shift.start_time);
		const rawEnd = clockMinutes(day.shift.end_time);
		const endClock = rawEnd <= startClock ? rawEnd + 1440 : rawEnd;
		const interval = { day, start: base + startClock, end: base + endClock };
		const bucket = byEmployment.get(day.employment_id);
		if (bucket) bucket.push(interval);
		else byEmployment.set(day.employment_id, [interval]);
	}

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
