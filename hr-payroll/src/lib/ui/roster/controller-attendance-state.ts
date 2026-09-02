type AttendanceIntervalValue = Readonly<{
	start: string;
	end: string | null;
}>;

export type AttendanceValue = Readonly<{
	/** `null` is unrecorded; `[]` is an explicit reviewed-no-work fact. */
	intervals: readonly AttendanceIntervalValue[] | null;
	breakMinutes: number;
}>;

type PersonDayPlanMutation = Readonly<{
	rosterCodeId: string;
	rosterId: string;
	note: string | null;
}>;

type PersonDayMutationInput = Readonly<{
	id: string | null;
	employmentId: string;
	date: string;
	plan: PersonDayPlanMutation | null;
	attendance: AttendanceValue | null;
}>;

type PersonDayMutationFields = Readonly<{
	shift_definition_id?: string;
	roster_id?: string;
	planned_origin?: 'MANUAL';
	planned_note?: string | null;
	worked_intervals?: readonly AttendanceIntervalValue[] | null;
	break_minutes?: number;
}>;

export type PersonDayMutation =
	| (Readonly<{ id: string }> & PersonDayMutationFields)
	| (Readonly<{ employment_id: string; work_date: string }> & PersonDayMutationFields);

export type DaySheetSaveIntent = 'none' | 'assignment' | 'attendance' | 'changes';

const sameIntervals = (
	left: readonly AttendanceIntervalValue[] | null,
	right: readonly AttendanceIntervalValue[] | null
): boolean => {
	if (left === null || right === null) return left === right;
	return (
		left.length === right.length &&
		left.every(
			(interval, index) =>
				interval.start === right[index]?.start && interval.end === right[index]?.end
		)
	);
};

/** Compare actual attendance without collapsing unrecorded `null` into reviewed-empty `[]`. */
export function attendanceChanged(baseline: AttendanceValue, draft: AttendanceValue): boolean {
	return (
		!sameIntervals(baseline.intervals, draft.intervals) ||
		baseline.breakMinutes !== draft.breakMinutes
	);
}

export function daySheetSaveIntent(
	planChanged: boolean,
	actualChanged: boolean
): DaySheetSaveIntent {
	if (planChanged && actualChanged) return 'changes';
	if (planChanged) return 'assignment';
	if (actualChanged) return 'attendance';
	return 'none';
}

type DaySheetSaveLabelKey =
	'roster.save_punch' | 'roster.save_changes' | 'roster.save_attendance' | 'roster.save_assignment';

/** Footer copy for the pending write. An employee never sees the assignment picker. */
export function daySheetSaveLabelKey(
	mode: 'controller' | 'employee',
	intent: DaySheetSaveIntent
): DaySheetSaveLabelKey {
	if (mode !== 'controller') return 'roster.save_punch';
	switch (intent) {
		case 'changes':
			return 'roster.save_changes';
		case 'attendance':
			return 'roster.save_attendance';
		case 'assignment':
		case 'none':
			return 'roster.save_assignment';
		default: {
			const unhandled: never = intent;
			throw new Error(`Unhandled day-sheet save intent: ${String(unhandled)}`);
		}
	}
}

/**
 * Interval attendance is gated on the same assessment the hook will make. The two interval-free
 * states are intentional exceptions: `[]` is reviewed-no-work and `null` is explicit clearing.
 */
export function daySheetAttendanceSaveAllowed(
	draft: AttendanceValue,
	missingIntervalStart: boolean,
	problem: string | null
): boolean {
	if (draft.intervals == null || draft.intervals.length === 0) return true;
	return !missingIntervalStart && problem == null;
}

/**
 * Identity for a person-day write. The sheet's known id (from facts) wins; the loaded-row id is
 * the fallback when attendance was not in the change. Either id is an UPDATE. Null is a create.
 */
export function resolvePersonDayWriteId(
	storedId: string | null | undefined,
	knownWorkDayId: string | null | undefined
): string | null {
	return knownWorkDayId ?? storedId ?? null;
}

/**
 * Build one partial person-day mutation. Omitted halves are deliberately absent, so updating
 * attendance on a planned row cannot rewrite its roster fields and creating attendance on an empty
 * day cannot materialize a plan.
 */
export function buildPersonDayMutation(input: PersonDayMutationInput): PersonDayMutation {
	const plan =
		input.plan == null
			? {}
			: {
					shift_definition_id: input.plan.rosterCodeId,
					roster_id: input.plan.rosterId,
					planned_origin: 'MANUAL' as const,
					planned_note: input.plan.note
				};
	const attendance =
		input.attendance == null
			? {}
			: {
					worked_intervals: input.attendance.intervals,
					break_minutes:
						input.attendance.intervals == null || input.attendance.intervals.length === 0
							? 0
							: input.attendance.breakMinutes
				};
	if (input.id == null) {
		return { employment_id: input.employmentId, work_date: input.date, ...plan, ...attendance };
	}
	return { id: input.id, ...plan, ...attendance };
}
