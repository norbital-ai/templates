import { dateKey } from '../iso-day.js';
import type { LeaveCharge } from '../../datatypes/leave_charges/+definition.js';

/**
 * One manual Leave activity, flat.
 *
 * There is no discriminator column: which activity an entry is, is the presence of its fields. A
 * chargeable range makes it time off; keys the activity writes and readers classify with the same
 * answer.
 */
export type LeaveActivityKind =
	'TIME_OFF' | 'ENCASHMENT' | 'CARRY_FORWARD' | 'ADJUSTMENT' | 'REVERSAL';

export type LeaveEntryActivity = {
	readonly from_date?: string | null;
	readonly to_date?: string | null;
	readonly half_day_start?: boolean | null;
	readonly half_day_end?: boolean | null;
	readonly days?: number | null;
	readonly encash_days?: number | null;
	/** The reversal marker; a plain row it is absent or false. */
	readonly as_adjustment_entry?: boolean;
	readonly reversal_of_id?: string | null;
	readonly effective_on?: string | null;
	readonly due_on?: string | null;
	readonly destination_from?: string | null;
	readonly destination_to?: string | null;
	readonly available_from?: string | null;
	readonly expires_on?: string | null;
	readonly reason?: string | null;
	readonly charges?: readonly LeaveCharge[];
};

/**
 * Field presence is the discriminator, in the one order that is unambiguous.
 *
 * The tick is the reversal marker; encashed days the encashment; a destination the carry-forward.
 * What remains is time off when the days are still unmeasured (the approval computes them from the
 * range), and an adjustment when they are stated — the adjustment is the one activity whose days
 * are its own.
 */
export function leaveActivityOf(fields: LeaveEntryActivity): LeaveActivityKind {
	if (fields.as_adjustment_entry === true) return 'REVERSAL';
	if (fields.encash_days != null) return 'ENCASHMENT';
	if (fields.destination_from != null || fields.destination_to != null) return 'CARRY_FORWARD';
	if ((fields.charges?.length ?? 0) > 0 || fields.days == null) return 'TIME_OFF';
	return 'ADJUSTMENT';
}

/** A stored day instant as its calendar day; absent stays absent. */
function leaveDayOf(value: string | null | undefined): string | null {
	return value == null || value === '' ? null : dateKey(value) || null;
}

/** A stored leave row with every day-instant resolved to its calendar day. */
export function normaliseLeaveDays<T extends LeaveEntryActivity>(row: T): T {
	return {
		...row,
		from_date: leaveDayOf(row.from_date),
		to_date: leaveDayOf(row.to_date),
		effective_on: leaveDayOf(row.effective_on),
		due_on: leaveDayOf(row.due_on),
		destination_from: leaveDayOf(row.destination_from),
		destination_to: leaveDayOf(row.destination_to),
		available_from: leaveDayOf(row.available_from),
		expires_on: leaveDayOf(row.expires_on)
	} as T;
}

/** The flat time-off fields a new entry opens on: one full day, not charged yet. */ export function defaultTimeOffFields(
	on: string
) {
	return {
		from_date: on,
		to_date: on,
		half_day_start: false,
		half_day_end: false,
		days: null,
		encash_days: null,
		as_adjustment_entry: false,
		reversal_of_id: null,
		effective_on: null,
		due_on: null,
		destination_from: null,
		destination_to: null,
		available_from: null,
		expires_on: null,
		reason: null
	} as const;
}

/** Every flat activity field, cleared: the base one activity's own fields are layered onto. */
export function emptyActivityFields() {
	return {
		from_date: null,
		to_date: null,
		half_day_start: null,
		half_day_end: null,
		days: null,
		encash_days: null,
		as_adjustment_entry: false,
		reversal_of_id: null,
		effective_on: null,
		due_on: null,
		destination_from: null,
		destination_to: null,
		available_from: null,
		expires_on: null,
		reason: null
	} as const;
}
