import { refuse } from '@norbital-ai/bolt/authoring';
import { isCalendarDate } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import type { LeaveEntitlement } from '../../datatypes/leave_entitlement/+definition.js';
import { calendarDay } from '../iso-day.js';
import {
	addDays,
	daysBetween,
	inclusiveDays,
	monthBounds,
	monthDay
} from '../../collections/payroll_runs/lib/dates.js';
import { roundHalfDay } from '../../collections/payroll_runs/lib/rounding.js';
import {
	evaluatePersonNumber,
	isEligible,
	type PersonContext
} from '../../collections/payroll_runs/lib/eligibility.js';

/** One inclusive window of leave days: the annual period a credit belongs to. */
export const leaveWindowSchema = Schema.Struct({ start: calendarDay, end: calendarDay });
export type LeaveWindow = Schema.Schema.Type<typeof leaveWindowSchema>;

/** MONTHLY without proration is a fresh allowance per calendar month; earned annual leave keeps its annual window. */
export function leaveWindowOf(
	date: string,
	period: number | Pick<LeaveEntitlement, 'year_start_month' | 'availability' | 'proration'>
): LeaveWindow {
	const startMonth = typeof period === 'number' ? period : period.year_start_month;
	if (!isCalendarDate(date) || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12)
		refuse('A leave window needs a valid date and annual starting month.');
	if (
		typeof period !== 'number' &&
		period.availability === 'MONTHLY' &&
		period.proration === 'NONE'
	)
		return monthBounds(date.slice(0, 7));
	const year = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < startMonth ? 1 : 0);
	const start = monthDay(year, startMonth - 1, 1);
	return { start, end: addDays(monthDay(year + 1, startMonth - 1, 1), -1) };
}

export function assertLeaveWindow(
	window: LeaveWindow,
	period: Parameters<typeof leaveWindowOf>[1]
): void {
	const expected = leaveWindowOf(window.start, period);
	if (window.start !== expected.start || window.end !== expected.end)
		refuse(
			'The stated window must match the leave catalogue’s annual period or monthly allowance.'
		);
}

/**
 * The days the matrix grants this person: top-down, the first band whose predicate holds, its
 * `days` a figure or a number over the person (a seniority ladder with no top). Nobody matched
 * is no days.
 */
export function grantedDays(rule: Pick<LeaveEntitlement, 'bands'>, person: PersonContext): number {
	const band = rule.bands.find((candidate) => isEligible(candidate.eligibility, person));
	if (band == null) return 0;
	return typeof band.days === 'string'
		? Math.max(0, evaluatePersonNumber(band.days, person))
		: band.days;
}

/** An as-of query over effective rules and employment facts; this creates no records. */
export function computedEntitlement(options: {
	readonly rule: LeaveEntitlement;
	readonly window: LeaveWindow;
	readonly asOf: string;
	readonly hireDate: string;
	readonly exitDate: string | null;
	/** A day of service the grant is measured over: employed, on terms, under a sealed version. */
	readonly servedOn: (date: string) => boolean;
	/** Eligibility is evaluated against the effective person facts on each date. */
	readonly eligibleOn: (date: string) => boolean;
	/** The person the entitlement bands are read against, as of the entitlement date. */
	readonly personOn: (date: string) => PersonContext;
}) {
	const { rule, window } = options;
	assertLeaveWindow(window, rule);
	if (
		!isCalendarDate(options.asOf) ||
		!isCalendarDate(options.hireDate) ||
		(options.exitDate != null && !isCalendarDate(options.exitDate))
	)
		refuse('Invalid entitlement calculation dates.');
	const start = options.hireDate > window.start ? options.hireDate : window.start;
	const end =
		options.exitDate != null && options.exitDate < window.end ? options.exitDate : window.end;
	const through = options.asOf < end ? options.asOf : end;
	// A per-event grant is no annual pool: every entry is measured against `grantedDays` on its
	// own, so the pool reads as unmetered here.
	const unlimited = rule.availability === 'UNLIMITED' || rule.availability === 'PER_EVENT';
	// A full grant or unmetered entitlement needs eligibility through the query date only.
	// Prorated upfront grants also project the remaining eligible part of the annual window.
	const projectionEnd = unlimited || rule.proration === 'NONE' ? through : end;
	/**
	 * A qualifying period bars the taking, not the counting. SG EA s.43: an employee who has
	 * served three months is entitled to leave in proportion to the completed months of service
	 * *in the year*, so a 1 January hire holds 7 × 4/12 on 1 May, not 7 × 1/12 — reading the gate
	 * as an accrual start under-granted every SG first year. Service before the leave opens
	 * therefore counts; once open, a day the person is no longer eligible on (a rise out of the
	 * Act's coverage) stops the count, as the grant is the Act's.
	 */
	const served = daysBetween(start, projectionEnd).filter(options.servedOn);
	const active = served.filter(options.eligibleOn);
	const opening = active[0] ?? null;
	const counted =
		opening == null ? [] : served.filter((date) => date < opening || options.eligibleOn(date));
	// Ineligible (or not-yet-started) is no balance, never an unmetered one: an unlimited flag here
	// would print a 0.00 row for a leave type the person cannot take at all.
	const empty = { window, opening, unlimited: false, entitlement: 0, earned: 0, available: 0 };
	if (opening == null || through < opening) return empty;
	// Earned by credit only: no rule grants days, so every debit must be funded by a posted
	// credit in the same window.
	if (rule.availability === 'CREDITED') return empty;
	// The entitlement matrix: top-down, the first band whose predicate holds on the entitlement
	// date is the grant; nobody matched is no days.
	const target = grantedDays(rule, options.personOn(through));
	if (unlimited)
		return { window, opening, unlimited: true, entitlement: null, earned: null, available: null };
	const eligible = new Set(counted);
	const fraction = (to: string): number => {
		if (to < opening) return 0;
		switch (rule.proration) {
			case 'NONE':
				return 1;
			case 'CALENDAR_DAYS':
				return (
					counted.filter((date) => date <= to).length / inclusiveDays(window.start, window.end)
				);
			case 'CALENDAR_MONTHS':
				return (
					counted.filter((date) => date <= to && date === monthBounds(date.slice(0, 7)).end)
						.length / 12
				);
			case 'HALF_MONTHS': {
				// A month is counted once it has ended and at least half its days were eligible.
				let months = 0;
				for (
					let month = window.start.slice(0, 7);
					monthBounds(month).end <= to;
					month = addDays(monthBounds(month).end, 1).slice(0, 7)
				) {
					const days = daysBetween(monthBounds(month).start, monthBounds(month).end);
					if (days.filter((date) => eligible.has(date)).length * 2 >= days.length) months += 1;
				}
				return months / 12;
			}
			case 'COMPLETED_MONTHS': {
				let complete = 0;
				for (let month = 0; month < 12; month += 1) {
					const from = monthDay(
						Number(start.slice(0, 4)),
						Number(start.slice(5, 7)) - 1 + month,
						Number(start.slice(8, 10))
					);
					const until = addDays(
						monthDay(
							Number(start.slice(0, 4)),
							Number(start.slice(5, 7)) + month,
							Number(start.slice(8, 10))
						),
						-1
					);
					if (until > to || until > end) break;
					if (daysBetween(from, until).every((date) => eligible.has(date))) complete += 1;
				}
				return complete / 12;
			}
		}
	};
	// The statute's own rounding of a part-year grant: MY s.60E(1) and SG s.88A(3) disregard a
	// fraction under a half and count a half or more as a day; elsewhere the half day stands.
	const round = (value: number): number =>
		rule.rounding === 'WHOLE_DAY' ? Math.floor(value + 0.5 + 1e-9) : roundHalfDay(value);
	const entitlement = round(target * fraction(end));
	const earned = round(target * fraction(through));
	const releasedThrough =
		through === monthBounds(through.slice(0, 7)).end
			? through
			: addDays(monthBounds(through.slice(0, 7)).start, -1);
	const available =
		rule.availability === 'UPFRONT' || rule.proration === 'NONE'
			? entitlement
			: round(target * fraction(releasedThrough));
	return { window, opening, unlimited: false, entitlement, earned, available };
}
