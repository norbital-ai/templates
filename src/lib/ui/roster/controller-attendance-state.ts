/**
 * The person-day's save vocabulary, shared by every surface that edits one.
 *
 * `AttendanceValue` is what the editor holds, `attendanceChanged` is how it knows the clock was
 * touched, and `daySaveIntent` / `daySaveLabelKey` name the write the form is about to make. The
 * controller's board and Employee Self-Service render the same record surface, so the labels are
 * decided once, from the intent, rather than by each caller.
 */
type AttendanceIntervalValue = Readonly<{
	start: string;
	end: string | null;
}>;

export type AttendanceValue = Readonly<{
	/** `null` is unrecorded; `[]` is an explicit reviewed-no-work fact. */
	intervals: readonly AttendanceIntervalValue[] | null;
}>;

type DaySaveIntent = 'none' | 'assignment' | 'attendance' | 'overtime' | 'changes';

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
	return !sameIntervals(baseline.intervals, draft.intervals);
}

export function daySaveIntent(
	planChanged: boolean,
	actualChanged: boolean,
	overtimeChanged = false
): DaySaveIntent {
	if (planChanged && (actualChanged || overtimeChanged)) return 'changes';
	if (actualChanged && overtimeChanged) return 'changes';
	if (planChanged) return 'assignment';
	if (actualChanged) return 'attendance';
	if (overtimeChanged) return 'overtime';
	return 'none';
}

type DaySaveLabelKey =
	| 'roster.save_punch'
	| 'roster.save_changes'
	| 'roster.save_attendance'
	| 'roster.save_overtime'
	| 'roster.save_assignment';

/** Footer copy for the pending write. An employee never sees the assignment picker. */
export function daySaveLabelKey(
	mode: 'controller' | 'employee',
	intent: DaySaveIntent
): DaySaveLabelKey {
	if (mode !== 'controller') return 'roster.save_punch';
	switch (intent) {
		case 'changes':
			return 'roster.save_changes';
		case 'attendance':
			return 'roster.save_attendance';
		case 'overtime':
			return 'roster.save_overtime';
		case 'assignment':
		case 'none':
			return 'roster.save_assignment';
		default: {
			const unhandled: never = intent;
			throw new Error(`Unhandled day save intent: ${String(unhandled)}`);
		}
	}
}
