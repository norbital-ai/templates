import { Array as EffectArray } from 'effect';
/**
 * L-TPL-hr-payroll-058: a rostered WORK shift with no clock-in after the entity's grace is late;
 * committed TIME_OFF and any recorded worked_intervals (including an empty AWOL list) skip the notice.
 */
import { parseDateTime, toZoned } from '@internationalized/date';
import type { Id } from '@norbital-ai/bolt';
import { Result } from 'effect';
import { coversDay, type LeaveMovement } from './leave.js';
import type { ShiftVariant } from './shift_pattern.js';

const TIME = /^\d{2}:\d{2}$/;

type LateArrivalCandidate = {
	readonly roster_entry_id: Id<'roster_entry'>;
	readonly employment_id: string;
	readonly work_date: string;
	readonly worked_intervals: unknown;
	readonly shift: ShiftVariant;
	readonly grace_minutes: number;
	readonly time_zone: string;
	readonly employee_name: string;
	readonly employee_number: string;
	readonly shift_code: string;
};

type LateArrivalNotice = {
	readonly once: string;
	readonly roster_entry_id: Id<'roster_entry'>;
	readonly title: string;
	readonly body: string;
};

function shiftStartMs(
	work_date: string,
	start_time: string,
	time_zone: string
): number | null {
	if (!TIME.test(start_time)) return null;
	return Result.getOrElse(
		Result.try(() =>
			toZoned(parseDateTime(`${work_date}T${start_time}`), time_zone)
				.toDate()
				.getTime()
		),
		() => null
	);
}

export function lateArrivalNotices(input: {
	readonly now_ms: number;
	readonly lookback_ms: number;
	readonly candidates: readonly LateArrivalCandidate[];
	readonly leave: readonly LeaveMovement[];
}): LateArrivalNotice[] {
	const out: LateArrivalNotice[] = [];
	for (const row of input.candidates) {
		const start_time = row.shift?.start_time;
		if (row.shift?.day_type !== 'WORK' || start_time == null || !TIME.test(start_time)) continue;
		if (EffectArray.isArray(row.worked_intervals)) continue;
		if (
			input.leave.some(
				(leave) => leave.employment_id === row.employment_id && coversDay(leave, row.work_date)
			)
		)
			continue;
		const start = shiftStartMs(row.work_date, start_time, row.time_zone);
		if (start == null) continue;
		const late_for = input.now_ms - (start + row.grace_minutes * 60_000);
		if (late_for < 0 || late_for > input.lookback_ms) continue;
		out.push({
			once: `late:${row.employment_id}:${row.work_date}`,
			roster_entry_id: row.roster_entry_id,
			title: `Late for work: ${row.employee_name} (${row.employee_number})`,
			body: `No clock-in for the ${start_time} shift (${row.shift_code}) on ${row.work_date}.`
		});
	}
	return out;
}
