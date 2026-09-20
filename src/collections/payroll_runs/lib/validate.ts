/**
 * Step 2 — VALIDATE.
 *
 * Everything that can be wrong before a single employee is read, plus the ceilings only a measured
 * run can test. A run that would silently under-contribute, silently not pay for work done, or
 * silently read a missing decision as "not chargeable" is stopped here, with a message that names
 * the row to fix.
 *
 * Configuration faults still fail the run: a rate band with no pay item, an opt-in naming a scheme
 * the version does not levy, or a pay cadence the company calendar cannot express. Hours-of-work
 * ceilings do not: compliance belongs to the schedule gate, and a measured
 * overrun is reported here so the run still builds — Infotech paid those months, and refusing the
 * whole payroll because one person worked 12.3 hours hides every loan, leave and claim the
 * operator came to settle.
 *
 * Issues stay structured rather than free text, so a screen can link to the row that caused each
 * one, and every message names the employee, the day and the rule wherever a run has them to name.
 */

import { decodeNumber } from '@norbital-ai/std/json';
import { INCENTIVE_LINE, OVERTIME_LINE } from '../../../lib/payroll/work-bands.js';

import { Schema } from 'effect';
import type { Configuration } from './configuration.js';
import { orderSchemes } from './mentions.js';
import type { FamilyPayItem } from '../../../lib/payroll/family.js';
import { dateKey, requiredDateKey } from './dates.js';
import type { DailyOvertime } from './overtime.js';
import { ruleDayType } from './schedule.js';
import { coversDate } from './effective.js';
import { paysOn } from './period.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
import type { RosterCodeVariant } from '../../../datatypes/roster_code_variant/+definition.js';

const IssueSeveritySchema = Schema.Literals(['BLOCKER', 'WARNING']);
type IssueSeverity = Schema.Schema.Type<typeof IssueSeveritySchema>;

const RunIssueSchema = Schema.Struct({
	code: Schema.String,
	message: Schema.String,
	severity: Schema.optionalKey(IssueSeveritySchema),
	collection: Schema.optionalKey(Schema.String),
	recordId: Schema.optionalKey(Schema.String)
});
export type RunIssue = Schema.Schema.Type<typeof RunIssueSchema>;

export function blockers(issues: readonly RunIssue[]): RunIssue[] {
	return issues.filter((issue) => issue.severity !== 'WARNING');
}

/** Configuration checks. None of them read a person. */
export function validateConfiguration(configuration: Configuration): RunIssue[] {
	const issues: RunIssue[] = [];
	const blocker = (code: string, message: string, collection?: string, recordId?: string): void => {
		issues.push({ code, message, collection, recordId });
	};

	if (configuration.work.proration == null)
		blocker(
			'PRORATION_MISSING',
			`Jurisdiction ${configuration.jurisdiction.code} states no proration basis, so a partial ` +
				'month cannot be paid.',
			'jurisdiction_settings',
			configuration.jurisdiction.id
		);

	// Every rate band must settle under a pay item of its own (line:label), or the run has no
	// component to price the hours it produces.
	for (const band of configuration.work.bands) {
		const outputs = [OVERTIME_LINE, ...(band.funnel_above_hours == null ? [] : [INCENTIVE_LINE])];
		for (const line of outputs)
			if (
				!configuration.catalogueComponents.some(
					(component) => component.family === 'WORK' && component.output === `${line}:${band.label}`
				)
			)
				blocker(
					'WORK_BAND_COMPONENT_MISSING',
					`${configuration.company.name} has no ${line} ${band.label} Work pay item, so the band ` +
						'has nothing to settle under.',
					'companies',
					configuration.company.id
				);
	}

	// ── the schemes ─────────────────────────────────────────────────────────────────────────────
	for (const contribution of configuration.contributions) {
		const code = contribution.row.code;
		if (contribution.rules.length === 0)
			blocker(
				'CONTRIBUTION_UNBANDED',
				`${code} has no rules effective for this period, so it could not charge anything.`,
				'statutory_contributions',
				contribution.row.id
			);
		// A ladder keyed on the entity's risk class covers nobody while the entity states none
		// (TW occupational-accident insurance, ID JKK): a mandatory premium priced at nothing
		// because a field is blank is a configuration hole, not a rule that happened to miss.
		if (
			(configuration.company.risk_class ?? '') === '' &&
			contribution.rules.every((rule) => rule.when.includes('employment.risk_class'))
		)
			blocker(
				'RISK_CLASS_UNSET',
				`${code} prices by the entity's statutory risk class, and ${configuration.company.name} ` +
					'states none: set the class on the entity before this run can charge it.',
				'companies',
				configuration.company.id
			);
	}
	// The dependency graph is derived from `produced.<code>` mentions and nothing else: a loop, or a
	// mention of a scheme not in force, refuses before any charge is computed.
	try {
		orderSchemes(configuration.contributions);
	} catch (error) {
		blocker(
			'CONTRIBUTION_DEPENDENCY',
			error instanceof Error ? error.message : String(error),
			'statutory_contributions',
			configuration.contributions[0]?.row.id ?? ''
		);
	}

	// Overtime needs no completeness check: MEASURE emits a line straight from the priced segment,
	// so every rule a day enters pays by construction.
	return issues;
}

type ValidateOvertimeLimitsOptions = {
	readonly configuration: Configuration;
	readonly employeeNumber: string;
	/** Regulated overtime this run measured, by calendar month. */
	readonly hoursByMonth: ReadonlyMap<string, number>;
	/** Every hour beyond the normal day, rest days and holidays included, for an ALL_OVERTIME_HOURS limit. */
	readonly allHoursByMonth?: ReadonlyMap<string, number>;
	/** Regulated overtime earlier PAID payslips settled, by calendar month; read by QUARTER and YEAR. */
	readonly priorHoursByMonth?: ReadonlyMap<string, number>;
};

/** The calendar bucket a month falls in under one limit period. */
function limitBucket(month: string, period: 'MONTH' | 'QUARTER' | 'YEAR'): string {
	const [year, monthNumber] = month.split('-');
	if (period === 'MONTH') return month;
	if (period === 'YEAR') return year ?? month;
	return `${year}-Q${Math.ceil(decodeNumber(monthNumber) / 3)}`;
}

/**
 * The overtime ceilings that only a measured run can test.
 *
 * A MONTH ceiling reads this run's months; a QUARTER or YEAR ceiling reads the calendar quarter
 * or year to date — the months earlier PAID payslips settled plus this run's. The report is always
 * a warning: enforcement is the schedule gate's, not the run's.
 */
export function validateOvertimeLimits(options: ValidateOvertimeLimitsOptions): RunIssue[] {
	const issues: RunIssue[] = [];
	for (const limit of options.configuration.limits) {
		// The hours are regulated *overtime*, so only a limit that counts overtime hours may be
		// compared against them. A TOTAL_WORK_HOURS row is a different quantity, not a stricter one.
		const period = limit.period;
		if (
			(limit.measure !== 'OVERTIME_HOURS' && limit.measure !== 'ALL_OVERTIME_HOURS') ||
			(period !== 'MONTH' && period !== 'QUARTER' && period !== 'YEAR')
		)
			continue;
		const measured =
			limit.measure === 'ALL_OVERTIME_HOURS'
				? (options.allHoursByMonth ?? options.hoursByMonth)
				: options.hoursByMonth;
		const totals = new Map<string, number>();
		const add = (month: string, hours: number) => {
			const bucket = limitBucket(month, period);
			totals.set(bucket, (totals.get(bucket) ?? 0) + hours);
		};
		for (const [month, hours] of measured) add(month, hours);
		if (period !== 'MONTH')
			for (const [month, hours] of options.priorHoursByMonth ?? [])
				if (
					[...measured.keys()].some(
						(own) => limitBucket(own, period) === limitBucket(month, period)
					)
				)
					add(month, hours);
		for (const [bucket, hours] of totals) {
			if (!(hours > decodeNumber(limit.max_hours))) continue;
			issues.push({
				code: 'OVERTIME_LIMIT_EXCEEDED',
				severity: 'WARNING' as const,
				message:
					`${options.employeeNumber} worked ${hours} regulated overtime hours in ${bucket}, ` +
					`against a ${limit.max_hours}-hour calendar-${period.toLowerCase()} ceiling ` +
					`(${options.configuration.work.authority ?? 'the Work rules'}). The run will still ` +
					'be built; the schedule gate is where this ceiling refuses.',
				collection: 'jurisdiction_settings',
				recordId: options.configuration.jurisdiction.id
			});
		}
	}
	return issues;
}

/**
 * A day past the hours-of-work limit.
 *
 * The excess is still routed to incentive OT rather than discarded, so the arithmetic is defined.
 * Historical vendor months contain many such days; refusing the whole run over them hides every
 * other settlement. The issue is a warning that names the person and the date.
 */
export function validateDailyWorkLimit(options: {
	readonly employeeNumber: string;
	readonly days: readonly DailyOvertime[];
	readonly maxWorkHours: number;
	/** A CLOCK_HOURS limit is a span: its evaluated ceiling subtracts the day's recorded break. */
	readonly unit?: 'WORKED_HOURS' | 'CLOCK_HOURS';
}): RunIssue[] {
	const maximum = (day: DailyOvertime): number =>
		options.unit === 'CLOCK_HOURS'
			? Math.max(0, options.maxWorkHours - day.breakMinutes / 60)
			: options.maxWorkHours;
	return options.days
		.filter((day) => day.totalWorkHours > maximum(day))
		.map((day) => ({
			code: 'DAILY_WORK_LIMIT_EXCEEDED',
			severity: 'WARNING' as const,
			message:
				`${options.employeeNumber} worked ${day.totalWorkHours.toFixed(2)} hours on ${day.date}, ` +
				`above the ${maximum(day)}-hour daily limit. The run will still be built; ` +
				'correct the attendance for that day, or record why the hours stand.',
			collection: 'work_days',
			recordId: day.workDayId
		}));
}

/**
 * An ordinary day past the jurisdiction's daily overtime-hours ceiling.
 *
 * Vietnam and Indonesia state this as four overtime hours, not twelve total-work hours. The
 * surplus is still routed to incentive OT. Rest-day and public-holiday work is not compared
 * here — those day types are outside this counter.
 */
export function validateDailyOvertimeHoursLimit(options: {
	readonly employeeNumber: string;
	readonly days: readonly DailyOvertime[];
	readonly maxOvertimeHours: number;
}): RunIssue[] {
	return options.days
		.filter(
			(day) => ruleDayType(day.dayType) === 'ORDINARY' && day.hours > options.maxOvertimeHours
		)
		.map((day) => ({
			code: 'DAILY_OVERTIME_LIMIT_EXCEEDED',
			severity: 'WARNING' as const,
			message:
				`${options.employeeNumber} worked ${day.hours.toFixed(2)} overtime hours on ${day.date}, ` +
				`above the ${options.maxOvertimeHours}-hour daily overtime limit. The run will still be built; ` +
				'hours past the ceiling are paid as incentive overtime at the same statutory rate.',
			collection: 'work_days',
			recordId: day.workDayId
		}));
}

/**
 * Work days whose clock never stopped.
 *
 * An open interval has no duration, so nothing downstream can price it: `normalizedWorkedIntervals`
 * refuses one by name three phases further in, and the engine used to pre-empt that with a bare
 * `find` and a throw. That reported the **first** open clock and no others, so an operator with
 * thirty-six of them — which is what a month of real attendance looks like when people forget to
 * clock out — fixed one, rebuilt, and met the next. Thirty-six builds to learn thirty-six records.
 *
 * As issues they are all reported at once, each carrying the row to open, and the run refuses
 * exactly as hard as it did before. This does not decide *whether* an open clock blocks payroll; it
 * decides that the operator is told the whole list the first time.
 *
 * Every work day GATHER read is checked, not only the ones inside the attendance window. That is
 * deliberate and it matches what MEASURE consumes: the schedule is walked across both calendar
 * months the cutoff touches so the monthly statutory overtime counter resets correctly, so an open
 * clock on the 29th of a month whose window closed on the 20th is still read by this run, and still
 * stops it.
 */
type ValidateOpenWorkDaysOptions = {
	readonly bundles: readonly {
		readonly employment: { readonly employee_number: string };
		readonly workDays: readonly {
			readonly id: string;
			readonly work_date: string;
			readonly worked_intervals:
				| readonly {
						readonly start: string;
						readonly end: string | null;
				  }[]
				| null;
		}[];
	}[];
};

export function validateOpenWorkDays(options: ValidateOpenWorkDaysOptions): RunIssue[] {
	const issues: RunIssue[] = [];
	for (const bundle of options.bundles) {
		for (const entry of bundle.workDays) {
			// Both bounds, not only the end. A clock-out with no clock-in is just as unpriceable as a
			// clock that never stopped. A NULL `worked_intervals` is neither of those: it says no
			// attendance was recorded for the day at all, which is a plan and not an open clock.
			const open = entry.worked_intervals?.some(
				(interval) => interval.end == null || interval.start == null
			);
			if (open !== true) continue;
			issues.push({
				code: 'WORK_DAY_OPEN',
				message:
					`${bundle.employment.employee_number} has an unclosed clock on ` +
					`${requiredDateKey(entry.work_date, 'work_days.work_date')}. Payroll cannot price a ` +
					'clock that has not stopped — close it, or clear that day’s attendance.',
				collection: 'work_days',
				recordId: entry.id
			});
		}
	}
	return issues;
}

/**
 * Whether the company's pay calendar can express the cadence its people are actually paid on.
 *
 * `companies.pay_cutoff_day` describes a **monthly** calendar: one window, one run a month. A
 * company whose people are not all monthly says so in `companies.pay_frequency`: `SEMI_MONTHLY`
 * pays its semi-monthly employments in two fixed instalments. When it does, there is nothing wrong
 * here and this check is silent, which is the case at the Philippine entity where twelve of
 * twenty-three employments are `SEMI_MONTHLY` because the law requires payment at least twice a
 * month.
 *
 * What is still a fault, and still stops the run, is an employment paid on a cadence the company
 * has never written a calendar for. Payroll would otherwise run them on the monthly calendar
 * because that is the only calendar there is, and paying someone once a month on a window they were
 * never promised is a wrong answer that looks exactly like a right one on the payslip. The fix is a
 * row on the company, and the message names the people whose pay is waiting for it.
 */
type ValidatePayCalendarOptions = {
	readonly configuration: Configuration;
	readonly bundles: readonly {
		readonly employment: { readonly employee_number: string; readonly id: string };
		readonly terms: readonly { readonly pay_frequency: string | null }[];
	}[];
};

export function validatePayCalendar(options: ValidatePayCalendarOptions): RunIssue[] {
	const company = options.configuration.company;
	const expressible = (frequency: string): boolean => paysOn(company, frequency);
	const unpayable = options.bundles.filter((bundle) =>
		bundle.terms.some((row) => row.pay_frequency != null && !expressible(row.pay_frequency))
	);
	if (unpayable.length === 0) return [];
	const cadenceSet = new Set<string>();
	for (const bundle of unpayable)
		for (const row of bundle.terms) {
			const frequency = row.pay_frequency;
			if (frequency == null || expressible(frequency)) continue;
			cadenceSet.add(frequency);
		}
	const cadences = [...cadenceSet].join(', ');
	// Named, not counted: "3 employments" sends an operator hunting, and the whole point of failing
	// the run is that they can act on it.
	const named = unpayable.map((bundle) => bundle.employment.employee_number).toSorted();
	return [
		{
			code: 'PAY_CALENDAR_CADENCE_UNSTATED',
			message:
				`${named.join(', ')} at ${company.name} are on ${cadences} terms, but ${company.name} ` +
				`pays ${company.pay_frequency} (cutoff ${company.pay_cutoff_day}). Set the company's pay ` +
				'frequency to the cadence its people are paid on: there is no window this payroll could ' +
				'run them on until the company says when their period opens, closes and pays.',
			collection: 'companies',
			recordId: company.id
		}
	];
}

/**
 * The WORK roster codes of one company, as the rostered-expectation check reads them: which codes
 * count as a scheduled WORK day, and the paid minutes each one carries.
 */
export function rosteredWorkCodeMaps(
	codes: readonly { readonly id: string; readonly variant: RosterCodeVariant }[]
): {
	readonly workCodeIds: ReadonlySet<string>;
	readonly offCodeIds: ReadonlySet<string>;
	readonly paidMinutesByCode: ReadonlyMap<string, number>;
} {
	const workCodeIds = new Set<string>();
	const offCodeIds = new Set<string>();
	const paidMinutesByCode = new Map<string, number>();
	for (const code of codes) {
		let kind: 'WORK' | 'REST' | 'OFF';
		try {
			kind = rosterCodeKind(code.variant);
		} catch {
			continue;
		}
		if (kind === 'OFF') offCodeIds.add(code.id);
		if (kind !== 'WORK') continue;
		workCodeIds.add(code.id);
		const window = workWindow(code.variant);
		if (window != null) paidMinutesByCode.set(code.id, window.paid_minutes);
	}
	return { workCodeIds, offCodeIds, paidMinutesByCode };
}

/**
 * The guaranteed or capped load of rostered employments, validated at precheck over the pay window.
 *
 * This is the arithmetic `validateRosterSchedule` used to run at roster publication, moved to where
 * the money is: a rostered employment has no pattern day, so every WORK day is an explicit row and
 * a date with no row is nothing. A declared week is scaled to the window's active days over seven
 * and checked with the `WORKLOAD_BELOW_TERMS` (days, and minutes where a minimum is stated) and
 * `WORKLOAD_ABOVE_TERMS` (where a maximum is) sentences. Cycle employments are not read: their
 * month is the cycle.
 *
 * A MONTHLY rostered employment with zero expected days in the window is refused outright: a
 * monthly salary with no schedule cannot derive ordinary hours. A declared minimum of paid
 * minutes supplies them when stated.
 */
type RosteredExpectation = {
	readonly days_per_week: number;
	readonly minimum_paid_minutes_per_week: number | null;
	readonly maximum_paid_minutes_per_week: number | null;
};

type RosteredValidationTerms = {
	readonly id: string;
	readonly pay_frequency: string | null;
	readonly work_pattern:
		| { readonly days: readonly { readonly roster_code_id: string }[] }
		| { readonly expectation: RosteredExpectation }
		| null;
	readonly effective_range: unknown;
};

/** The expectation a term states, or null where it projects a day cycle (or names none). */
function expectationOf(term: RosteredValidationTerms): RosteredExpectation | null {
	const pattern = term.work_pattern;
	return pattern != null && 'expectation' in pattern ? pattern.expectation : null;
}

type RosteredValidationDay = {
	readonly work_date: string;
	readonly shift_definition_id: string | null;
};

export function validateRosteredExpectations(options: {
	readonly period: string;
	/** The run's attendance window; an employment settled over another one states its own. */
	readonly window: { readonly start: string; readonly end: string };
	readonly employments: readonly {
		readonly id: string;
		readonly employee_number: string;
		readonly terms: readonly RosteredValidationTerms[];
		readonly workDays: readonly RosteredValidationDay[];
		/**
		 * The attendance window this employment is paid over, when it is not the run's: at a
		 * semi-monthly company the run's window is the envelope of two cadences, and a load is
		 * measured over the one instalment the employment is actually paid for.
		 */
		readonly window?: { readonly start: string; readonly end: string };
	}[];
	readonly workCodeIds: ReadonlySet<string>;
	/** Holiday and company-off codes: a day the schedule cannot use, so the guarantee does not count it. */
	readonly offCodeIds?: ReadonlySet<string>;
	/** The calendar's holidays: a paid day the roster cannot assign, so it meets the guarantee as a day. */
	readonly holidayDates?: ReadonlySet<string>;
	readonly paidMinutesByCode: ReadonlyMap<string, number>;
}): RunIssue[] {
	const issues: RunIssue[] = [];
	const offCodeIds = options.offCodeIds ?? new Set<string>();
	const datesOf = (window: { readonly start: string; readonly end: string }): string[] => {
		const dates: string[] = [];
		for (
			let date = window.start;
			date <= window.end;
			date = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
		) {
			dates.push(date);
		}
		return dates;
	};
	for (const employment of options.employments) {
		// Bounds may arrive as instants (a run's stored window) or as calendar days; the row filter
		// below is a string comparison, so both sides are reduced to the day they name in the
		// payroll zone — slicing an instant files a day picked in the UI one day early.
		const raw = employment.window ?? options.window;
		const window = {
			start: dateKey(raw.start) || String(raw.start).slice(0, 10),
			end: dateKey(raw.end) || String(raw.end).slice(0, 10)
		};
		const windowDates = datesOf(window);
		const touching = employment.terms.filter((term) =>
			windowDates.some((date) => coversDate(term.effective_range, date))
		);
		if (!touching.some((term) => expectationOf(term) != null)) continue;
		const explicitByDate = new Map<string, string>();
		for (const day of employment.workDays) {
			const date = dateKey(day.work_date);
			if (
				date == null ||
				date < window.start ||
				date > window.end ||
				day.shift_definition_id == null
			)
				continue;
			explicitByDate.set(date, day.shift_definition_id);
		}
		const expectedInWindow = windowDates.filter((date) => {
			const codeId = explicitByDate.get(date);
			return codeId != null && options.workCodeIds.has(codeId);
		});
		// A monthly salary with no schedule cannot derive ordinary hours. A declared minimum of
		// paid minutes supplies them instead, and its shortfall is the `WORKLOAD_BELOW_TERMS`
		// issue below rather than this refusal.
		const hasGuarantee = touching.some(
			(term) => expectationOf(term)?.minimum_paid_minutes_per_week != null
		);
		if (
			expectedInWindow.length === 0 &&
			!hasGuarantee &&
			touching.every((term) => expectationOf(term) != null) &&
			touching.some((term) => term.pay_frequency === 'MONTHLY')
		) {
			issues.push({
				code: 'ROSTERED_ZERO_SCHEDULE',
				message:
					`${employment.employee_number} is on MONTHLY terms with no scheduled WORK days in ` +
					`the ${options.period} pay window: a monthly salary with no schedule cannot derive ` +
					`ordinary hours. State the guaranteed schedule in the employment terms, or assign ` +
					`the month's days.`,
				collection: 'employments',
				recordId: employment.id
			});
			continue;
		}
		for (const term of touching) {
			const expectation = expectationOf(term);
			if (expectation == null) continue;
			const activeDates = windowDates.filter(
				(date) =>
					coversDate(term.effective_range, date) && !offCodeIds.has(explicitByDate.get(date) ?? '')
			);
			if (activeDates.length === 0) continue;
			const fraction = activeDates.length / 7;
			const worked = activeDates.filter((date) => {
				const codeId = explicitByDate.get(date);
				return codeId != null && options.workCodeIds.has(codeId);
			});
			const holidays = activeDates.filter(
				(date) => options.holidayDates?.has(date) === true && !worked.includes(date)
			);
			const actualDays = worked.length + holidays.length;
			const workedMinutes = worked.reduce(
				(total, date) => total + (options.paidMinutesByCode.get(explicitByDate.get(date)!) ?? 0),
				0
			);
			// A declaration owes whole days: 6 a week over 39 days is 33.4, and the roster meets it
			// with 33. Rounding up refused a leaver's real six-day roster for a day nobody owed; the
			// minutes a guarantee owes are those whole days' share, not the fraction's. A holiday
			// counts as one declared day's minutes (EA s.60D: a paid holiday).
			const requiredDays = decodeNumber(expectation.days_per_week);
			const expectedDays = Math.floor(requiredDays * fraction);
			const minimum = expectation.minimum_paid_minutes_per_week;
			const expectedMinutes =
				minimum == null
					? 0
					: Math.floor(
							requiredDays > 0
								? (decodeNumber(minimum) * expectedDays) / requiredDays
								: decodeNumber(minimum) * fraction
						);
			const actualMinutes =
				workedMinutes +
				(minimum == null || requiredDays <= 0
					? 0
					: (holidays.length * decodeNumber(minimum)) / requiredDays);
			// A shortfall is the employer's contract to answer for, not the run's: the monthly
			// salary is paid on the terms whatever the roster held, so the run warns and proceeds.
			if (actualDays < expectedDays || actualMinutes < expectedMinutes) {
				issues.push({
					code: 'WORKLOAD_BELOW_TERMS',
					severity: 'WARNING',
					message:
						`The pay window assigns ${actualDays} work day(s) and ${workedMinutes} paid minute(s) ` +
						`for ${employment.employee_number}, below the employment terms of ${expectedDays} day(s)` +
						`${minimum == null ? '' : ` and ${expectedMinutes} minute(s)`}.`,
					collection: 'employments',
					recordId: employment.id
				});
			}
			const maximum = expectation.maximum_paid_minutes_per_week;
			if (maximum != null && workedMinutes > Math.floor(decodeNumber(maximum) * fraction)) {
				issues.push({
					code: 'WORKLOAD_ABOVE_TERMS',
					severity: 'WARNING',
					message:
						`The pay window assigns ${worked.length} work day(s) and ${workedMinutes} paid minute(s) ` +
						`for ${employment.employee_number}, above the employment cap of ${decodeNumber(maximum)} minute(s) a week.`,
					collection: 'employments',
					recordId: employment.id
				});
			}
		}
	}
	return issues;
}

/** How many issues a failure message spells out before it starts counting. */
const DETAILED_ISSUE_LIMIT = 25;

/** How many people one grouped bullet names before it starts counting. */
const PERSONS_PER_BULLET = 10;

/**
 * An employee-number-shaped token: capitals-led with a digit inside, so `MY` in
 * "Jurisdiction MY states no basis" never masks but `NHPMY0354` always does.
 */
const PERSON_TOKEN = /[A-Z]{2,}[A-Z0-9_-]*\d[A-Z0-9_-]*/;

/**
 * Splits one refusal sentence into the person it names and the shape around them.
 *
 * Two shapes cover every person-naming sentence this file emits: `… for PERSON, …`
 * (the workload sentences) and a leading `PERSON …` (rostered schedules, daily limits).
 * Anything else is not a person naming — it renders whole, exactly as before.
 */
const splitPerson = (
	message: string
): { readonly template: string; readonly person: string } | null => {
	const match = PERSON_TOKEN.exec(message);
	if (match === null) return null;
	const person = match[0];
	const forPhrase = ` for ${person},`;
	if (message.includes(forPhrase)) {
		return { template: message.replace(forPhrase, ''), person };
	}
	if (match.index === 0) {
		const rest = message.slice(person.length).trimStart();
		return { template: rest.charAt(0).toUpperCase() + rest.slice(1), person };
	}
	return null;
};

type IssueCluster = {
	readonly code: string;
	readonly template: string;
	readonly persons: string[];
	readonly sample: string;
};

/**
 * Why the payroll refused, in the operator's words rather than the engine's.
 *
 * Repeated shortfalls share one bullet — fourteen rostered employments with no schedule
 * read as one named group with the shape stated once, not fourteen paragraphs. Every
 * person is still named (capped per bullet with an honest count past the cap), and a
 * shape that names nobody renders whole exactly as before. A very large failure is
 * capped so the message stays readable, and says plainly how many it did not print.
 */
export function describeIssues(
	issues: readonly RunIssue[],
	kind: 'block' | 'warn' = 'block'
): string {
	const clusters: IssueCluster[] = [];
	for (const issue of issues) {
		const split = splitPerson(issue.message);
		const template = split?.template ?? issue.message;
		const found = clusters.find(
			(cluster) => cluster.code === issue.code && cluster.template === template
		);
		if (found === undefined) {
			clusters.push({
				code: issue.code,
				template,
				persons: split === null ? [] : [split.person],
				sample: issue.message
			});
		} else if (split !== null && !found.persons.includes(split.person)) {
			found.persons.push(split.person);
		}
	}
	const renderCluster = (cluster: IssueCluster): string => {
		if (cluster.persons.length <= 1) return `• ${cluster.code}: ${cluster.sample}`;
		const shown = cluster.persons.slice(0, PERSONS_PER_BULLET);
		const remaining = cluster.persons.length - shown.length;
		const names =
			shown.join(', ') +
			(remaining > 0 ? `, and ${remaining} other${remaining === 1 ? '' : 's'}` : '');
		return `• ${cluster.code} (${cluster.persons.length}) — ${names}: ${cluster.template}`;
	};
	const shown = clusters.slice(0, DETAILED_ISSUE_LIMIT);
	const remaining = clusters.length - shown.length;
	const headline =
		kind === 'warn'
			? issues.length === 1
				? 'Payroll built with one warning:'
				: `Payroll built with ${issues.length} warnings:`
			: issues.length === 1
				? 'Payroll was not built. One thing must be fixed first:'
				: `Payroll was not built. ${issues.length} things must be fixed first:`;
	const tail = remaining > 0 ? `\n… and ${remaining} more of the same kinds, listed above.` : '';
	return `${headline}\n${shown.map(renderCluster).join('\n')}${tail}`;
}
