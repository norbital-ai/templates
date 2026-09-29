import { refuse } from '../refuse.js';
import { isCalendarDate } from '../iso-day.js';
import { Schema } from 'effect';
import type { LeaveEntitlement } from '../datatypes/leave_entitlement.js';
import { calendarDay } from '../iso-day.js';
import {
	addDays,
	completedMonths,
	daysBetween,
	inclusiveDays,
	monthBounds,
	monthDay
} from '../../lib/payroll/run/dates.js';
import { roundHalfDay } from '../../lib/payroll/run/rounding.js';
import {
	evaluatePersonNumber,
	isEligible,
	type PersonContext
} from '../../lib/payroll/run/eligibility.js';
import * as Predicate from 'effect/Predicate';

/** One inclusive window of leave days: the annual period a credit belongs to. */
export const leaveWindowSchema = Schema.Struct({ start: calendarDay, end: calendarDay });
export type LeaveWindow = Schema.Schema.Type<typeof leaveWindowSchema>;

/** The annual period as a catalogue row states it: a stored column reads an absent key as `null`. */
export type LeavePeriod =
	| number
	| (Pick<LeaveEntitlement, 'year_start_month' | 'availability' | 'proration'> & {
			readonly year_anchor?: LeaveEntitlement['year_anchor'] | null;
	  });

/** MONTHLY without proration is a fresh allowance per calendar month; earned annual leave keeps its annual window. */
export function leaveWindowOf(date: string, period: LeavePeriod, hireDate?: string): LeaveWindow {
	const startMonth = Predicate.isNumber(period) ? period : period.year_start_month;
	if (!isCalendarDate(date) || !Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12)
		refuse('A leave window needs a valid date and annual starting month.');
	if (!Predicate.isNumber(period) && period.year_anchor === 'SERVICE_ANNIVERSARY') {
		if (hireDate == null || !isCalendarDate(hireDate))
			refuse('A service-year leave window needs the employment hire date.');
		if (hireDate.slice(5) === '02-29')
			refuse('A 29 February hire needs a documented service-anniversary convention.');
		const anniversary = (year: number) => `${year}-${hireDate.slice(5)}`;
		const calendarYear = Number.parseInt(date.slice(0, 4), 10);
		const year = date < anniversary(calendarYear) ? calendarYear - 1 : calendarYear;
		return { start: anniversary(year), end: addDays(anniversary(year + 1), -1) };
	}
	if (
		!Predicate.isNumber(period) &&
		period.availability === 'MONTHLY' &&
		period.proration === 'NONE'
	)
		return monthBounds(date.slice(0, 7));
	const year =
		Number.parseInt(date.slice(0, 4), 10) -
		(Number.parseInt(date.slice(5, 7), 10) < startMonth ? 1 : 0);
	const start = monthDay(year, startMonth - 1, 1);
	return { start, end: addDays(monthDay(year + 1, startMonth - 1, 1), -1) };
}

export function assertLeaveWindow(
	window: LeaveWindow,
	period: Parameters<typeof leaveWindowOf>[1],
	hireDate?: string
): void {
	const expected = leaveWindowOf(window.start, period, hireDate);
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
export function grantedDays(
	rule: Pick<LeaveEntitlement, 'bands' | 'scale'>,
	person: PersonContext
): number {
	const band = rule.bands.find((candidate) => isEligible(candidate.eligibility, person));
	if (band == null) return 0;
	const days = Predicate.isString(band.days)
		? Math.max(0, evaluatePersonNumber(band.days, person))
		: band.days;
	const scale = (rule.scale ?? '').trim();
	return scale === '' ? days : days * Math.max(0, evaluatePersonNumber(scale, person));
}

/** Completed hire-anniversary months after excluding whole or fractional no-pay days. */
export function completedLeaveServiceMonths(start: string, serviceDays: number): number {
	const equivalent = addDays(start, Math.floor(Math.max(0, serviceDays)));
	const year = Number.parseInt(start.slice(0, 4), 10);
	const month = Number.parseInt(start.slice(5, 7), 10) - 1;
	const day = Number.parseInt(start.slice(8, 10), 10);
	let months = completedMonths(start, equivalent);
	if (monthDay(year, month + months + 1, day) <= equivalent) months += 1;
	return months;
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
	/** Calendar-day equivalents excluded from continuous service (SG EA s.88A(4)). */
	readonly serviceExcludedOn?: ((date: string) => number) | undefined;
	/** Part-time statutory grants are measured in hours against the comparable full-time worker. */
	readonly hourlyBasisOn?:
		| ((
				date: string
		  ) => { readonly grantHoursPerDay: number; readonly normalDailyHours: number } | null)
		| undefined;
}) {
	const { rule, window } = options;
	assertLeaveWindow(window, rule, options.hireDate);
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
	const projectionEnd =
		unlimited || (rule.proration === 'NONE' && rule.qualifies_window !== true) ? through : end;
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
	const unit: 'DAY' | 'HOUR' = options.hourlyBasisOn?.(through) == null ? 'DAY' : 'HOUR';
	const empty = {
		window,
		opening,
		unit,
		unlimited: false,
		entitlement: 0,
		earned: 0,
		available: 0
	};
	// A year qualified as a whole grants the year's days once it qualifies on any day of it.
	if (opening == null || (through < opening && rule.qualifies_window !== true)) return empty;
	const hourlyBasisOn = options.hourlyBasisOn;
	if (
		!unlimited &&
		rule.requires_hourly_for_part_time === true &&
		hourlyBasisOn != null &&
		served.some(
			(date) => date <= through && (hourlyBasisOn(date) == null ? 'DAY' : 'HOUR') !== unit
		)
	)
		refuse('A leave year crossing part-time and full-time terms needs separate hourly accounting.');
	// Earned by credit only: no rule grants days, so every debit must be funded by a posted
	// credit in the same window.
	if (rule.availability === 'CREDITED') return empty;
	// The entitlement matrix: top-down, the first band whose predicate holds on the entitlement
	// date is the grant; nobody matched is no days.
	// A year qualified as a whole reads its bands on its first and last days of service: a child
	// below an age at any time in the year is below it on one of them, as every age span the
	// bands name outlasts a year (SG CDCA s.12B(1)(b)).
	const dates = rule.qualifies_window === true ? [counted[0]!, counted.at(-1)!] : [through];
	const people = dates.map(options.personOn);
	const bases = dates.map((date) => options.hourlyBasisOn?.(date) ?? null);
	if (bases.some((basis) => (basis == null ? 'DAY' : 'HOUR') !== unit))
		refuse('A leave year crossing part-time and full-time terms needs separate hourly accounting.');
	const target = Math.max(
		...people.map((person, index) =>
			unit === 'HOUR'
				? grantedDays({ ...rule, scale: null }, person) * bases[index]!.grantHoursPerDay
				: grantedDays(rule, person)
		)
	);
	// A grant the scale moved is the regulation's hours in the person's own days, which no
	// statute rounds: it rounds up to the half day, never below the hours owed.
	const scaled =
		unit === 'DAY' &&
		target !== Math.max(...people.map((person) => grantedDays({ ...rule, scale: null }, person)));
	if (unlimited)
		return {
			window,
			opening,
			unit,
			unlimited: true,
			entitlement: null,
			earned: null,
			available: null
		};
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
				if (options.serviceExcludedOn != null) {
					const countedDays = counted.filter((date) => date <= to);
					const excluded = countedDays.reduce(
						(sum, date) => sum + options.serviceExcludedOn!(date),
						0
					);
					const effectiveDays = Math.max(0, countedDays.length - excluded);
					return Math.min(12, completedLeaveServiceMonths(start, effectiveDays)) / 12;
				}
				let complete = 0;
				for (let month = 0; month < 12; month += 1) {
					const from = monthDay(
						Number.parseInt(start.slice(0, 4), 10),
						Number.parseInt(start.slice(5, 7), 10) - 1 + month,
						Number.parseInt(start.slice(8, 10), 10)
					);
					const until = addDays(
						monthDay(
							Number.parseInt(start.slice(0, 4), 10),
							Number.parseInt(start.slice(5, 7), 10) + month,
							Number.parseInt(start.slice(8, 10), 10)
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
	// Never below the row's floor (SG CDCA s.12B(1)(i): 2 days however short the service).
	const floor =
		target > 0
			? Math.min(
					target,
					unit === 'HOUR'
						? (rule.minimum_days ?? 0) * (bases[0]?.normalDailyHours ?? 0)
						: (rule.minimum_days ?? 0)
				)
			: 0;
	const round = (value: number): number =>
		Math.max(
			floor,
			unit === 'HOUR'
				? Math.ceil(value * 1000 - 1e-9) / 1000
				: scaled
					? Math.ceil(value * 2 - 1e-9) / 2
					: rule.rounding === 'WHOLE_DAY'
						? Math.floor(value + 0.5 + 1e-9)
						: rule.rounding === 'WHOLE_DAY_DOWN'
							? Math.floor(value + 1e-9)
							: rule.rounding === 'EXACT'
								? value
								: roundHalfDay(value)
		);
	const entitlement = round(target * fraction(end));
	const earned = round(target * fraction(through));
	const releasedThrough =
		rule.year_anchor === 'SERVICE_ANNIVERSARY' && rule.proration === 'COMPLETED_MONTHS'
			? through
			: through === monthBounds(through.slice(0, 7)).end
				? through
				: addDays(monthBounds(through.slice(0, 7)).start, -1);
	const available =
		rule.availability === 'UPFRONT' || rule.proration === 'NONE'
			? entitlement
			: round(target * fraction(releasedThrough));
	return { window, opening, unit, unlimited: false, entitlement, earned, available };
}
