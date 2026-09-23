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
	/** Hours, on a row taken by the hour; null elsewhere. */
	readonly hours?: number | null;
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
	readonly event_kind?: string | null;
	readonly event_relationship?: string | null;
	readonly event_child_index?: number | null;
	readonly event_date?: string | null;
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

/** The day-precision instant columns of a leave entry. */
export const LEAVE_DAY_COLUMNS = [
	'from_date',
	'to_date',
	'effective_on',
	'due_on',
	'destination_from',
	'destination_to',
	'available_from',
	'expires_on',
	'event_date'
] as const;

/** A stored leave row with every day-instant resolved to its calendar day. */
export function normaliseLeaveDays<T extends LeaveEntryActivity>(row: T): T {
	const out: Record<string, unknown> = { ...row };
	for (const key of LEAVE_DAY_COLUMNS) out[key] = leaveDayOf(row[key]);
	return out as T;
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
		hours: null,
		encash_days: null,
		as_adjustment_entry: false,
		reversal_of_id: null,
		effective_on: null,
		due_on: null,
		destination_from: null,
		destination_to: null,
		available_from: null,
		expires_on: null,
		reason: null,
		event_kind: null,
		event_relationship: null,
		event_child_index: null,
		event_date: null
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
		hours: null,
		encash_days: null,
		as_adjustment_entry: false,
		reversal_of_id: null,
		effective_on: null,
		due_on: null,
		destination_from: null,
		destination_to: null,
		available_from: null,
		expires_on: null,
		reason: null,
		event_kind: null,
		event_relationship: null,
		event_child_index: null,
		event_date: null
	} as const;
}

/**
 * The leave a pay period lists: every activity valued inside it, plus time off whose days overlap
 * it. The range columns alone are not enough — an adjustment, encashment or carry-forward stores
 * its entitlement window there, so a year-long window matched every month of the year. Time off is
 * told apart by its summary, which `leaveSummary` always opens with the activity kind.
 */
export function leavePeriodWhere(bounds: { readonly start: string; readonly end: string }) {
	return {
		OR: [
			{ effective_on: { gte: bounds.start, lt: bounds.end } },
			{
				summary: { like: 'TIME_OFF%' },
				from_date: { lt: bounds.end },
				to_date: { gte: bounds.start }
			}
		]
	};
}
