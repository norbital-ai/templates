type AttendanceIntervalValue = Readonly<{
	start: string;
	end: string | null;
}>;

export type AttendanceValue = Readonly<{
	/** `null` is unrecorded; `[]` is an explicit reviewed-no-work fact. */
	intervals: readonly AttendanceIntervalValue[] | null;
	breakMinutes: number;
}>;

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
