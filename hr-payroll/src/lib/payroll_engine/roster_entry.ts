/**
 * L-TPL-hr-payroll-051: worked intervals stay ordered and unpinned days stay editable; a payslip pin freezes the row.
 */
import { Schema } from 'effect';
import { moneyNumber, numberOf, stableJson } from './foundation.js';

const Stored = Schema.Array(
	Schema.Struct({
		start: Schema.String,
		end: Schema.optional(Schema.NullOr(Schema.String))
	})
);

/** A plan is a shift code and an optional overtime duration, never a separate set of clock periods. */
export function refusePlannedOvertime(
	value: unknown,
	shift: string | null | undefined
): string | null {
	if (value == null) return null;
	const hours = numberOf(value);
	if (hours == null || !Number.isFinite(hours) || hours < 0)
		return 'Planned OT hours must be a nonnegative duration.';
	return shift == null || shift === '' ? 'Choose a shift code for the planned overtime.' : null;
}

export function refuseWorkedIntervals(value: unknown): string | null {
	if (value == null) return null;
	if (!Schema.is(Stored)(value))
		return 'Worked intervals must be in time order and cannot overlap.';
	let previous: string | null = null;
	for (let index = 0; index < value.length; index++) {
		const row = value[index];
		if (row == null) continue;
		if (row.end == null && index !== value.length - 1)
			return 'Only the final worked interval may still be open.';
		if (row.end != null && row.end < row.start)
			return 'Worked intervals must be in time order and cannot overlap.';
		if (previous != null && row.start < previous)
			return 'Worked intervals must be in time order and cannot overlap.';
		previous = row.end ?? row.start;
	}
	return null;
}

const Approved = Schema.Array(
	Schema.Struct({
		start: Schema.String,
		end: Schema.String,
		break_minutes: Schema.optional(Schema.NullOr(Schema.Number))
	})
);

/** Historical approval windows are closed actual instants, ordered and non-overlapping. */
export function refuseApprovedOvertimeIntervals(value: unknown): string | null {
	if (value == null) return null;
	if (!Schema.is(Approved)(value))
		return 'Approved overtime windows must have a start and end time.';
	let previousEnd: number | null = null;
	for (const row of value) {
		const start = Date.parse(row.start),
			end = Date.parse(row.end);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
			return 'Approved overtime windows must have a valid end after their start.';
		const pause = row.break_minutes ?? 0;
		if (
			!Number.isFinite(pause) ||
			!Number.isInteger(pause) ||
			pause < 0 ||
			pause >= (end - start) / 60_000
		)
			return 'Approved overtime break minutes must be a nonnegative whole number shorter than the window.';
		if (previousEnd != null && start < previousEnd)
			return 'Approved overtime windows must be in time order and cannot overlap.';
		previousEnd = end;
	}
	return null;
}

/** A regular run's attendance window: the days its payslips settled for one employment. */
export type SettledWindow = { readonly from: string; readonly to: string };

export function refuseSettledWindow(
	windows: readonly SettledWindow[] | undefined,
	day: string
): string | null {
	return (windows ?? []).some((window) => window.from <= day && day <= window.to)
		? 'A day inside a period already captured by payroll cannot be changed.'
		: null;
}

const Interval = Schema.Struct({
	start: Schema.String,
	end: Schema.optional(Schema.NullOr(Schema.String))
});
const instantOf = (value: string | null | undefined) => (value == null ? null : Date.parse(value));
const same = (left: unknown, right: unknown, approved = false): boolean => {
	if (approved && Schema.is(Approved)(left) && Schema.is(Approved)(right))
		return (
			left.length === right.length &&
			left.every(
				(row, i) =>
					instantOf(row.start) === instantOf(right[i]!.start) &&
					instantOf(row.end) === instantOf(right[i]!.end) &&
					(row.break_minutes ?? 0) === (right[i]!.break_minutes ?? 0)
			)
		);
	if (Schema.is(Schema.Array(Interval))(left) && Schema.is(Schema.Array(Interval))(right))
		return (
			left.length === right.length &&
			left.every(
				(row, i) =>
					instantOf(row.start) === instantOf(right[i]!.start) &&
					instantOf(row.end) === instantOf(right[i]!.end)
			)
		);
	const a = moneyNumber(left),
		b = moneyNumber(right);
	if (a != null || b != null) return numberOf(left) === numberOf(right);
	return stableJson(left ?? null) === stableJson(right ?? null);
};

/** Whether a write restates the stored day: every column it names already holds its value. */
export function restates(input: object, before: object): boolean {
	const stored: { readonly [field: string]: unknown } = { ...before };
	const supplied: Readonly<Record<string, unknown>> = { ...input };
	return Object.entries(supplied).every(
		([field, value]) =>
			field === 'id' || same(value, stored[field], field === 'approved_overtime_intervals')
	);
}
