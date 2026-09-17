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
import { isEligible, type PersonContext } from '../../collections/payroll_runs/lib/eligibility.js';

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

/** An as-of query over effective rules and employment facts; this creates no records. */
export function computedEntitlement(options: {
	readonly rule: LeaveEntitlement;
	readonly window: LeaveWindow;
	readonly asOf: string;
	readonly hireDate: string;
	readonly exitDate: string | null;
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
	const unlimited = rule.availability === 'UNLIMITED';
	// A full grant or unmetered entitlement needs eligibility through the query date only.
	// Prorated upfront grants also project the remaining eligible part of the annual window.
	const projectionEnd = unlimited || rule.proration === 'NONE' ? through : end;
	const active = daysBetween(start, projectionEnd).filter(options.eligibleOn);
	const opening = active[0] ?? null;
	// Ineligible (or not-yet-started) is no balance, never an unmetered one: an unlimited flag here
	// would print a 0.00 row for a leave type the person cannot take at all.
	const empty = { window, opening, unlimited: false, entitlement: 0, earned: 0, available: 0 };
	if (opening == null || through < opening) return empty;
	// The entitlement matrix: top-down, the first band whose predicate holds on the entitlement
	// date is the grant; nobody matched is no days.
	const person = options.personOn(through);
	const target = rule.bands.find((band) => isEligible(band.eligibility, person))?.days ?? 0;
	if (unlimited)
		return { window, opening, unlimited: true, entitlement: null, earned: null, available: null };
	const eligible = new Set(active);
	const fraction = (to: string): number => {
		if (to < opening) return 0;
		switch (rule.proration) {
			case 'NONE':
				return 1;
			case 'CALENDAR_DAYS':
				return active.filter((date) => date <= to).length / inclusiveDays(window.start, window.end);
			case 'CALENDAR_MONTHS':
				return (
					active.filter((date) => date <= to && date === monthBounds(date.slice(0, 7)).end).length /
					12
				);
			case 'COMPLETED_MONTHS': {
				let complete = 0;
				for (let month = 0; month < 12; month += 1) {
					const from = monthDay(
						Number(opening.slice(0, 4)),
						Number(opening.slice(5, 7)) - 1 + month,
						Number(opening.slice(8, 10))
					);
					const until = addDays(
						monthDay(
							Number(opening.slice(0, 4)),
							Number(opening.slice(5, 7)) + month,
							Number(opening.slice(8, 10))
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
	const entitlement = roundHalfDay(target * fraction(end));
	const earned = roundHalfDay(target * fraction(through));
	const releasedThrough =
		through === monthBounds(through.slice(0, 7)).end
			? through
			: addDays(monthBounds(through.slice(0, 7)).start, -1);
	const available =
		rule.availability === 'UPFRONT' || rule.proration === 'NONE'
			? entitlement
			: roundHalfDay(target * fraction(releasedThrough));
	return { window, opening, unlimited: false, entitlement, earned, available };
}
