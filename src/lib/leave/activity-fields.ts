import type { PlainDate } from '@norbital-ai/std/date';
import { dateKey } from '../iso-day.js';
import type { LeaveCharge } from '../datatypes/leave_charges.js';

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
	readonly from_date?: string | null | undefined;
	readonly to_date?: string | null | undefined;
	readonly half_day_start?: boolean | null | undefined;
	readonly half_day_end?: boolean | null | undefined;
	readonly no_pay_origin?: 'EMPLOYEE_REQUESTED' | 'OTHER' | null | undefined;
	readonly days?: number | null | undefined;
	/** Hours on hourly time off, carry-forward or adjustment; null for day movements. */
	readonly hours?: number | null | undefined;
	readonly encash_days?: number | null | undefined;
	/** Hour-denominated statutory payout on departure. */
	readonly encash_hours?: number | null | undefined;
	/** The reversal marker; a plain row it is absent or false. */
	readonly as_adjustment_entry?: boolean | undefined;
	readonly reversal_of_id?: string | null | undefined;
	readonly effective_on?: string | null | undefined;
	readonly due_on?: string | null | undefined;
	readonly destination_from?: string | null | undefined;
	readonly destination_to?: string | null | undefined;
	readonly available_from?: string | null | undefined;
	readonly expires_on?: string | null | undefined;
	readonly reason?: string | null | undefined;
	readonly event_kind?: string | null | undefined;
	readonly event_relationship?: string | null | undefined;
	readonly event_child_index?: number | null | undefined;
	readonly event_wife_prior_living_biological_children?: number | null | undefined;
	readonly event_date?: string | null | undefined;
	/** Time off paid at a share the parties agreed (VN Labour Code art.99 stoppage): 0.7 is 70% of the day wage. */
	readonly agreed_pay_fraction?: number | null | undefined;
	readonly charges?: readonly LeaveCharge[] | undefined;
};

/**
 * Field presence is the discriminator, in the one order that is unambiguous.
 *
 * The tick is the reversal marker; encashed days or hours the encashment; a destination the
 * carry-forward. An adjustment states days or dated hours; unmeasured time off is computed from
 * its range, and saved time off carries dated charges.
 */
export function leaveActivityOf(fields: LeaveEntryActivity): LeaveActivityKind {
	if (fields.as_adjustment_entry === true) return 'REVERSAL';
	if (fields.encash_days != null || fields.encash_hours != null) return 'ENCASHMENT';
	if (fields.destination_from != null || fields.destination_to != null) return 'CARRY_FORWARD';
	if ((fields.charges?.length ?? 0) > 0) return 'TIME_OFF';
	if (fields.days != null || (fields.hours != null && fields.effective_on != null))
		return 'ADJUSTMENT';
	return 'TIME_OFF';
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

/** The decimal columns of a leave entry, which the wire carries as text. */
const LEAVE_DECIMAL_COLUMNS = [
	'days',
	'hours',
	'encash_days',
	'encash_hours',
	'agreed_pay_fraction'
] as const;

/** A stored leave row with every day resolved to its calendar day and every decimal to a number. */
export function normaliseLeaveDays<T extends LeaveEntryActivity>(row: T): T {
	const out: Record<string, unknown> = { ...row };
	for (const key of LEAVE_DAY_COLUMNS) out[key] = leaveDayOf(row[key]);
	for (const key of LEAVE_DECIMAL_COLUMNS) if (row[key] != null) out[key] = row[key];
	return out as T;
}

/** The flat time-off fields a new entry opens on: one full day, not charged yet. */ export function defaultTimeOffFields(
	on: PlainDate
) {
	return {
		from_date: on,
		to_date: on,
		half_day_start: false,
		half_day_end: false,
		no_pay_origin: null,
		days: null,
		hours: null,
		encash_days: null,
		encash_hours: null,
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
		event_wife_prior_living_biological_children: null,
		event_date: null,
		agreed_pay_fraction: null
	} as const;
}

/** Every flat activity field, cleared: the base one activity's own fields are layered onto. */
export function emptyActivityFields() {
	return {
		from_date: null,
		to_date: null,
		half_day_start: null,
		half_day_end: null,
		no_pay_origin: null,
		days: null,
		hours: null,
		encash_days: null,
		encash_hours: null,
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
		event_wife_prior_living_biological_children: null,
		event_date: null,
		agreed_pay_fraction: null
	} as const;
}

/**
 * The leave a pay period lists: every activity valued inside it, plus time off whose days overlap
 * it. The range columns alone are not enough — an adjustment, encashment or carry-forward stores
 * its entitlement window there, so a year-long window matched every month of the year. Time off is
 * told apart by its stored `activity`. Both window ends are inclusive days (the pay period's).
 */
export function leavePeriodWhere(window: { readonly start: PlainDate; readonly end: PlainDate }) {
	return {
		or: [
			{ effective_on: { gte: window.start, lte: window.end } },
			{
				activity: { eq: 'TIME_OFF' },
				from_date: { lte: window.end },
				to_date: { gte: window.start }
			}
		]
	} as const;
}
