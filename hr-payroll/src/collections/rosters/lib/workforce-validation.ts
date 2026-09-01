/** Pure publication checks for normalized monthly schedules. */

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
export type ValidationShift = Schema.Schema.Type<typeof validationShiftSchema>;

const validationDaySchema = Schema.Struct({
	employment_id: Schema.String,
	work_date: Schema.String,
	designation: Schema.NullOr(designationSchema),
	shift: Schema.NullOr(validationShiftSchema)
});
export type ValidationDay = Schema.Schema.Type<typeof validationDaySchema>;

const workloadExpectationSchema = Schema.Struct({
	employment_id: Schema.String,
	start_date: Schema.optional(Schema.String),
	end_date: Schema.optional(Schema.String),
	kind: Schema.Literals(['EXACT', 'MINIMUM', 'MAXIMUM']),
	work_days: Schema.NullOr(Schema.Number),
	paid_minutes: Schema.Number
});
export type WorkloadExpectation = Schema.Schema.Type<typeof workloadExpectationSchema>;

const violationCodeSchema = Schema.Literals([
	'SCHEDULE_CODE_MISSING',
	'OVERLAPPING_WORK_SHIFTS',
	'WORKLOAD_BELOW_TERMS',
	'WORKLOAD_ABOVE_TERMS',
	'WORKLOAD_DIFFERS_FROM_PATTERN'
]);
type ViolationCode = Schema.Schema.Type<typeof violationCodeSchema>;

const scheduleViolationSchema = Schema.Struct({
	code: violationCodeSchema,
	employment_id: Schema.String,
	dates: Schema.Array(Schema.String),
	message: Schema.String
});
type ScheduleViolation = Schema.Schema.Type<typeof scheduleViolationSchema>;

function clockMinutes(value: string): number {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
	if (match == null) throw new Error(`Not an HH:mm clock time: "${value}".`);
	return decodeNumber(match[1]) * 60 + decodeNumber(match[2]);
}

function paidMinutes(shift: ValidationShift): number {
	const start = clockMinutes(shift.start_time);
	const rawEnd = clockMinutes(shift.end_time);
	const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
	const paid = end - start - shift.break_minutes;
	if (paid <= 0) throw new Error(`Roster code ${shift.code} has no paid time.`);
	return paid;
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

export function validateRosterSchedule(input: {
	readonly days: readonly ValidationDay[];
	readonly expectations: readonly WorkloadExpectation[];
}): ScheduleViolation[] {
	const violations: ScheduleViolation[] = [];
	for (const overlap of overlappingWorkShifts(input.days)) {
		violations.push({
			code: 'OVERLAPPING_WORK_SHIFTS',
			employment_id: overlap.employment_id,
			dates: [overlap.first.work_date, overlap.second.work_date],
			message: `${overlap.first.work_date} ${overlap.first.shift?.code ?? 'WORK'} overlaps ${overlap.second.work_date} ${overlap.second.shift?.code ?? 'WORK'}.`
		});
	}
	const byEmployment = new Map<string, ValidationDay[]>();
	for (const day of input.days) {
		const bucket = byEmployment.get(day.employment_id);
		if (bucket) bucket.push(day);
		else byEmployment.set(day.employment_id, [day]);
		if (day.designation == null) {
			violations.push({
				code: 'SCHEDULE_CODE_MISSING',
				employment_id: day.employment_id,
				dates: [day.work_date],
				message: `${day.work_date} has no roster code.`
			});
		}
	}

	for (const expectation of input.expectations) {
		const days = (byEmployment.get(expectation.employment_id) ?? []).filter(
			(day) =>
				(expectation.start_date == null || day.work_date >= expectation.start_date) &&
				(expectation.end_date == null || day.work_date <= expectation.end_date)
		);
		const worked = days.filter((day) => day.designation === 'WORK');
		const actualDays = worked.length;
		const actualMinutes = worked.reduce(
			(total, day) => total + (day.shift == null ? 0 : paidMinutes(day.shift)),
			0
		);
		const below =
			actualMinutes < expectation.paid_minutes ||
			(expectation.work_days != null && actualDays < expectation.work_days);
		const above =
			actualMinutes > expectation.paid_minutes ||
			(expectation.work_days != null && actualDays > expectation.work_days);
		if (expectation.kind === 'MINIMUM' && below) {
			violations.push({
				code: 'WORKLOAD_BELOW_TERMS',
				employment_id: expectation.employment_id,
				dates: worked.map((day) => day.work_date),
				message: `The month assigns ${actualDays} work day(s) and ${actualMinutes} paid minute(s), below the employment terms of ${expectation.work_days ?? 'any number of'} day(s) and ${expectation.paid_minutes} minute(s).`
			});
		}
		if (expectation.kind === 'MAXIMUM' && above) {
			violations.push({
				code: 'WORKLOAD_ABOVE_TERMS',
				employment_id: expectation.employment_id,
				dates: worked.map((day) => day.work_date),
				message: `The month assigns ${actualDays} work day(s) and ${actualMinutes} paid minute(s), above the employment cap of ${expectation.paid_minutes} minute(s).`
			});
		}
		if (expectation.kind === 'EXACT' && (below || above)) {
			violations.push({
				code: 'WORKLOAD_DIFFERS_FROM_PATTERN',
				employment_id: expectation.employment_id,
				dates: worked.map((day) => day.work_date),
				message: `The month assigns ${actualDays} work day(s) and ${actualMinutes} paid minute(s); the repeating pattern derives ${expectation.work_days ?? 0} day(s) and ${expectation.paid_minutes} minute(s).`
			});
		}
	}
	return violations;
}
