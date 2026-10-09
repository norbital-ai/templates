/**
 * L-TPL-hr-payroll-051: worked intervals stay ordered and unpinned days stay editable; a payslip pin freezes the row.
 */
import { Schema } from 'effect';
import { moneyNumber, stableJson } from './foundation.js';

const Stored = Schema.Array(
	Schema.Struct({
		start: Schema.String,
		end: Schema.optional(Schema.NullOr(Schema.String))
	})
);

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

export function refusePinnedRoster(before: { readonly payslip_id?: string | null }): string | null {
	if (before.payslip_id == null) return null;
	return 'A settled day cannot be changed.';
}

/** A regular run's attendance window: the days its payslips settled for one employment. */
export type SettledWindow = { readonly from: string; readonly to: string };

export function refuseSettledWindow(
	windows: readonly SettledWindow[] | undefined,
	day: string
): string | null {
	return (windows ?? []).some((window) => window.from <= day && day <= window.to)
		? 'A day inside a period already paid cannot be changed.'
		: null;
}

const Interval = Schema.Struct({
	start: Schema.String,
	end: Schema.optional(Schema.NullOr(Schema.String))
});
const instantOf = (value: string | null | undefined) => (value == null ? null : Date.parse(value));
const same = (left: unknown, right: unknown): boolean => {
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
	if (a != null || b != null) return a === b;
	return stableJson(left ?? null) === stableJson(right ?? null);
};

/** Whether a write restates the stored day: every column it names already holds its value. */
export function restates(input: object, before: object): boolean {
	const stored: { readonly [field: string]: unknown } = { ...before };
	return Object.entries(input).every(
		([field, value]) => field === 'id' || same(value, stored[field])
	);
}
