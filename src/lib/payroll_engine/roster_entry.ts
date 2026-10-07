/**
 * L-TPL-hr-payroll-051: worked intervals stay ordered and unpinned days stay editable; a payslip pin freezes the row.
 */
import { Schema } from 'effect';

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
