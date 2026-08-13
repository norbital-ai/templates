/** Pure publication checks for normalized monthly schedules. */

export type Designation = 'WORK' | 'REST' | 'OFF';

export type ValidationShift = {
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

export type WorkloadExpectation = {
	readonly employment_id: string;
	readonly start_date?: string;
	readonly end_date?: string;
	readonly kind: 'EXACT' | 'MINIMUM' | 'MAXIMUM';
	readonly work_days: number | null;
	readonly paid_minutes: number;
};

export type ViolationCode =
	| 'SCHEDULE_CODE_MISSING'
	| 'OVERLAPPING_WORK_SHIFTS'
	| 'WORKLOAD_BELOW_TERMS'
	| 'WORKLOAD_ABOVE_TERMS'
	| 'WORKLOAD_DIFFERS_FROM_PATTERN';

export type ScheduleViolation = {
	readonly code: ViolationCode;
	readonly employment_id: string;
	readonly dates: readonly string[];
	readonly message: string;
};

function clockMinutes(value: string): number {
	const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
	if (match == null) throw new Error(`Not an HH:mm clock time: "${value}".`);
	return Number(match[1]) * 60 + Number(match[2]);
}

function paidMinutes(shift: ValidationShift): number {
	const start = clockMinutes(shift.start_time);
	const rawEnd = clockMinutes(shift.end_time);
	const end = rawEnd <= start ? rawEnd + 1440 : rawEnd;
	const paid = end - start - shift.break_minutes;
	if (paid <= 0) throw new Error(`Roster code ${shift.code} has no paid time.`);
	return paid;
}

export type WorkShiftOverlap = {
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
