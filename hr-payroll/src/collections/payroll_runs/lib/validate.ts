/**
 * Step 2 — VALIDATE.
 *
 * Everything that can be wrong before a single employee is read, plus the ceilings only a measured
 * run can test. A run that would silently under-contribute, silently not pay for work done, or
 * silently read a missing decision as "not chargeable" is stopped here, with a message that names
 * the row to fix.
 *
 * Configuration faults still fail the run: a missing treatment, an unbanded overtime rule, a scheme
 * that has not said what it does with overtime, or a pay cadence the company calendar cannot
 * express. Hours-of-work ceilings do not. A regime limit with `on_exceed=WARN` (and every daily
 * hours breach, which the engine already reclassifies to excess overtime) is reported and the run
 * still builds — Infotech paid those months, and refusing
 * the whole payroll because one person worked 12.3 hours hides every loan, leave and claim the
 * operator came to settle. `on_exceed=BLOCK` on a monthly overtime ceiling still stops the run.
 *
 * Issues stay structured rather than free text, so a screen can link to the row that caused each
 * one, and every message names the employee, the day and the rule wherever a run has them to name.
 */

import { getErrorMessage } from '@norbital-ai/std';
import { decodeNumber } from '@norbital-ai/std/json';

import { Effect, Result, Schema } from 'effect';
import type { Configuration } from './configuration.js';
import { dateKey, requiredDateKey } from './dates.js';
import type { DailyOvertime } from './overtime.js';
import { ruleDayType } from './schedule.js';
import { coversDate } from './effective.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';
import type { RosterCodeVariant } from '../../../datatypes/roster_code_variant/+definition.js';
import { parseSpecialRules } from './special-rules.js';

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

	if (configuration.jurisdiction.proration == null)
		blocker(
			'PRORATION_MISSING',
			`Jurisdiction ${configuration.jurisdiction.code} states no proration basis, so a partial ` +
				'month cannot be paid.',
			'jurisdictions',
			configuration.jurisdiction.id
		);

	// Every monetary component owns a decided cell for every effective statutory scheme.
	for (const component of configuration.payComponents) {
		if (component.nature === 'INFORMATION') continue;
		for (const contribution of configuration.contributions) {
			const cell = configuration.treatments.get(`${component.id}:${contribution.row.id}`);
			if (cell?.treatment == null) {
				blocker(
					'TREATMENT_MISSING',
					`No ${contribution.row.code} treatment exists for ${component.code}. Each component ` +
						'must state the decision in its policy.',
					'pay_components',
					component.id
				);
				continue;
			}
			if (cell.treatment.kind === 'UNSET')
				blocker(
					'TREATMENT_UNSET',
					`${component.code} × ${contribution.row.code} is undecided. Payroll cannot guess whether ` +
						'this kind of pay is chargeable.',
					'pay_components',
					component.id
				);
			if (
				cell.treatment.kind === 'SPECIAL' &&
				!contribution.row.special_rules.includes(cell.treatment.rule)
			)
				blocker(
					'SPECIAL_RULE_UNKNOWN',
					`${component.code} × ${contribution.row.code} names special rule "${cell.treatment.rule}", ` +
						`which ${contribution.row.code} does not declare.`,
					'pay_components',
					component.id
				);
		}
	}

	// ── the schemes ─────────────────────────────────────────────────────────────────────────────
	const sequenceById = new Map(
		configuration.contributions.map((entry) => [entry.row.id, decodeNumber(entry.row.sequence)])
	);
	for (const contribution of configuration.contributions) {
		const code = contribution.row.code;
		const parseOutcome = Effect.runSync(
			Effect.result(Effect.try(() => parseSpecialRules(contribution.row.special_rules, code)))
		);
		if (Result.isFailure(parseOutcome))
			blocker(
				'SPECIAL_RULE_INVALID',
				getErrorMessage(parseOutcome.failure),
				'statutory_contributions',
				contribution.row.id
			);
		if (contribution.rates.length === 0)
			blocker(
				'CONTRIBUTION_UNBANDED',
				`${code} has no rate bands effective for this period, so it could not charge anything.`,
				'statutory_contributions',
				contribution.row.id
			);
		const hasTerminalBand = contribution.rates.some((rate) => {
			const selector = rate.selector;
			if (selector == null) return false;
			return (selector.by === 'WAGE' || selector.by === 'WAGE_AND_AGE') && selector.to == null;
		});
		const isWageBanded =
			contribution.row.keyed_by === 'WAGE' || contribution.row.keyed_by === 'WAGE_AND_AGE';
		if (isWageBanded && contribution.rates.length > 0 && !hasTerminalBand)
			blocker(
				'CONTRIBUTION_NO_CEILING',
				`${code} has no open-ended terminal band. A ceiling is expressed as a band with no upper ` +
					'bound; without one, a wage above the highest band cannot be charged at all.',
				'contribution_rates',
				contribution.row.id
			);
		for (const relievedId of contribution.row.relief_for) {
			const relievedSequence = sequenceById.get(relievedId);
			if (relievedSequence == null) {
				blocker(
					'RELIEF_TARGET_MISSING',
					`${code} is a relief for a contribution that is not effective in this jurisdiction.`,
					'statutory_contributions',
					contribution.row.id
				);
				continue;
			}
			if (relievedSequence <= decodeNumber(contribution.row.sequence))
				blocker(
					'RELIEF_ORDER',
					`${code} is a relief inside a contribution that runs before it. A relief must be ` +
						'produced before the scheme that consumes it.',
					'statutory_contributions',
					contribution.row.id
				);
		}
	}

	// ── overtime completeness: a rule nothing can enter is work done for nothing ────────────────
	//
	// There used to be a second check here, `OVERTIME_RULE_UNMAPPED`: a stated rule that no pay
	// component claimed paid nothing, silently. That failure mode is gone rather than fixed —
	// MEASURE now emits a line straight from the priced segment, so every rule a day enters pays by
	// construction and there is nothing left to map. A rule with no band is still unenterable: no
	// hour can fall inside a band that does not exist, so it would pay nothing whatever MEASURE did.
	for (const rule of configuration.overtimeRules) {
		if (rule.band != null) continue;
		blocker(
			'OVERTIME_RULE_UNBANDED',
			`An overtime rule (${rule.authority}) carries no band and can never be entered.`,
			'jurisdictions',
			configuration.jurisdiction.id
		);
	}

	// ── overtime chargeability: a scheme with no stated position cannot charge overtime ─────────
	//
	// The same rule the treatment grid lives by, applied to the schedule that replaced its overtime
	// row: silence is an undecided scheme, not an exempt one. Caught here rather than at ACCUMULATE
	// so the run names the row to fix before anybody's payslip is measured.
	for (const contribution of configuration.contributions) {
		for (const [what, treatment] of [
			['overtime', contribution.overtimeTreatment],
			['excess overtime', contribution.overtimeExcessTreatment]
		] as const) {
			if (treatment != null) continue;
			blocker(
				'OVERTIME_TREATMENT_UNDECIDED',
				`${contribution.row.code} states no ${what} position effective in this period. A scheme ` +
					'that has not decided cannot be read as excluding it.',
				'statutory_contributions',
				contribution.row.id
			);
		}
	}

	return issues;
}

type ValidateOvertimeLimitsOptions = {
	readonly configuration: Configuration;
	readonly employeeNumber: string;
	readonly calendarMonth: string;
	readonly monthHours: number;
};

/**
 * The overtime ceilings that only a measured run can test.
 *
 * `on_exceed` decides whether the run stops. `WARN` names the person, the month and the authority
 * and lets the payslips be written; `BLOCK` refuses the whole run.
 */
export function validateOvertimeLimits(options: ValidateOvertimeLimitsOptions): RunIssue[] {
	return (
		options.configuration.overtimeLimits
			// `monthHours` is regulated *overtime*, so only a limit that counts overtime hours may be
			// compared against it. A TOTAL_WORK_HOURS row is a different quantity, not a stricter one.
			.filter(
				(limit) =>
					limit.period === 'MONTH' &&
					limit.measures === 'OVERTIME_HOURS' &&
					options.monthHours > decodeNumber(limit.max_hours)
			)
			.map((limit) => {
				const severity: IssueSeverity = limit.on_exceed === 'BLOCK' ? 'BLOCKER' : 'WARNING';
				const nextStep =
					severity === 'BLOCKER'
						? 'Reduce the recorded overtime, or raise the ceiling on the authority that states it, before this payroll can be built.'
						: 'The run will still be built; review the attendance or raise the ceiling if the hours should not stand.';
				return {
					code: 'OVERTIME_LIMIT_EXCEEDED',
					severity,
					message:
						`${options.employeeNumber} worked ${options.monthHours} regulated overtime hours in ` +
						`${options.calendarMonth}, against a ${limit.max_hours}-hour calendar-month ceiling ` +
						`(${limit.authority}, on_exceed=${limit.on_exceed}). ${nextStep}`,
					collection: 'jurisdictions',
					recordId: options.configuration.jurisdiction.id
				};
			})
	);
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
}): RunIssue[] {
	return options.days
		.filter((day) => day.totalWorkHours > options.maxWorkHours)
		.map((day) => ({
			code: 'DAILY_WORK_LIMIT_EXCEEDED',
			severity: 'WARNING' as const,
			message:
				`${options.employeeNumber} worked ${day.totalWorkHours.toFixed(2)} hours on ${day.date}, ` +
				`above the ${options.maxWorkHours}-hour daily limit. The run will still be built; ` +
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
 * `companies.pay_cutoff_day` and `pay_day` are one integer each, so between them they describe a
 * **monthly** calendar and nothing else: one window, one pay date, one run a month. A company whose
 * people are not all monthly states the rest in `companies.pay_calendar` — for a semi-monthly
 * cadence, the two instalments of the month with their own salary window and pay day. When it has,
 * there is nothing wrong here and this check is silent, which is the case at the Philippine entity
 * where twelve of twenty-three employments are `SEMI_MONTHLY` because the law requires payment at
 * least twice a month.
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
	const stated = new Set((company.pay_calendar ?? []).map((entry) => String(entry.pay_frequency)));
	// MONTHLY is never in `pay_calendar` and never needs to be: the two company columns are its
	// calendar, and every company has them.
	const expressible = (frequency: string): boolean =>
		frequency === 'MONTHLY' || stated.has(frequency);
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
				`states no ${cadences} pay calendar — only its monthly one (cutoff ` +
				`${company.pay_cutoff_day}, paid on ${company.pay_day}). Add the instalments of that ` +
				'cadence to the company pay calendar: there is no window this payroll could run them on ' +
				'until it can say when their period opens, closes and pays.',
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
	readonly paidMinutesByCode: ReadonlyMap<string, number>;
} {
	const workCodeIds = new Set<string>();
	const paidMinutesByCode = new Map<string, number>();
	for (const code of codes) {
		let kind: 'WORK' | 'REST' | 'OFF';
		try {
			kind = rosterCodeKind(code.variant);
		} catch {
			continue;
		}
		if (kind !== 'WORK') continue;
		workCodeIds.add(code.id);
		const window = workWindow(code.variant);
		if (window != null) paidMinutesByCode.set(code.id, window.paid_minutes);
	}
	return { workCodeIds, paidMinutesByCode };
}

/**
 * The guaranteed or capped load of rostered employments, validated at precheck over the pay window.
 *
 * This is the arithmetic `validateRosterSchedule` used to run at roster publication, moved to where
 * the money is: a rostered employment has no pattern day, so every WORK day is an explicit row and
 * a date with no row is nothing. `GUARANTEED_SCHEDULE` and `AS_ASSIGNED` expectations are checked
 * here with the same `WORKLOAD_BELOW_TERMS` and `WORKLOAD_ABOVE_TERMS` sentences. Patterned
 * employments are not read: their month must equal the pattern, and that is refused at write time.
 *
 * A MONTHLY rostered employment with zero expected days in the window is refused outright: a
 * monthly salary with no schedule cannot derive ordinary hours. `GUARANTEED_SCHEDULE` supplies
 * them when stated.
 */
type RosteredValidationTerms = {
	readonly id: string;
	readonly pay_frequency: string | null;
	readonly work_pattern:
		| { readonly type: 'PATTERNED' }
		| {
				readonly type: 'ROSTERED';
				readonly expectation:
					| {
							readonly kind: 'GUARANTEED_SCHEDULE';
							readonly period: 'WEEK' | 'MONTH';
							readonly required_work_days: number;
							readonly required_paid_minutes: number;
					  }
					| {
							readonly kind: 'AS_ASSIGNED';
							readonly period: 'WEEK' | 'MONTH';
							readonly maximum_paid_minutes: number | null;
					  };
		  };
	readonly effective_range: unknown;
};

type RosteredValidationDay = {
	readonly work_date: string;
	readonly shift_definition_id: string | null;
};

export function validateRosteredExpectations(options: {
	readonly period: string;
	readonly window: { readonly start: string; readonly end: string };
	readonly employments: readonly {
		readonly id: string;
		readonly employee_number: string;
		readonly terms: readonly RosteredValidationTerms[];
		readonly workDays: readonly RosteredValidationDay[];
	}[];
	readonly workCodeIds: ReadonlySet<string>;
	readonly paidMinutesByCode: ReadonlyMap<string, number>;
}): RunIssue[] {
	const issues: RunIssue[] = [];
	const windowDates: string[] = [];
	for (
		let date = options.window.start;
		date <= options.window.end;
		date = new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
	) {
		windowDates.push(date);
	}
	for (const employment of options.employments) {
		const touching = employment.terms.filter((term) =>
			windowDates.some((date) => coversDate(term.effective_range, date))
		);
		if (!touching.some((term) => term.work_pattern.type === 'ROSTERED')) continue;
		const explicitByDate = new Map<string, string>();
		for (const day of employment.workDays) {
			const date = dateKey(day.work_date);
			if (
				date == null ||
				date < options.window.start ||
				date > options.window.end ||
				day.shift_definition_id == null
			)
				continue;
			explicitByDate.set(date, day.shift_definition_id);
		}
		const expectedInWindow = windowDates.filter((date) => {
			const codeId = explicitByDate.get(date);
			return codeId != null && options.workCodeIds.has(codeId);
		});
		// A monthly salary with no schedule cannot derive ordinary hours. A stated
		// `GUARANTEED_SCHEDULE` supplies them instead, and its shortfall is the
		// `WORKLOAD_BELOW_TERMS` issue below rather than this refusal.
		const hasGuarantee = touching.some(
			(term) =>
				term.work_pattern.type === 'ROSTERED' &&
				term.work_pattern.expectation.kind === 'GUARANTEED_SCHEDULE'
		);
		if (
			expectedInWindow.length === 0 &&
			!hasGuarantee &&
			touching.every((term) => term.work_pattern.type === 'ROSTERED') &&
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
			if (term.work_pattern.type !== 'ROSTERED') continue;
			const expectation = term.work_pattern.expectation;
			const activeDates = windowDates.filter((date) => coversDate(term.effective_range, date));
			if (activeDates.length === 0) continue;
			const referenceDays = expectation.period === 'WEEK' ? 7 : windowDates.length;
			const fraction = activeDates.length / referenceDays;
			const worked = activeDates.filter((date) => {
				const codeId = explicitByDate.get(date);
				return codeId != null && options.workCodeIds.has(codeId);
			});
			const actualDays = worked.length;
			const actualMinutes = worked.reduce(
				(total, date) => total + (options.paidMinutesByCode.get(explicitByDate.get(date)!) ?? 0),
				0
			);
			if (expectation.kind === 'GUARANTEED_SCHEDULE') {
				const expectedDays = Math.ceil(decodeNumber(expectation.required_work_days) * fraction);
				const expectedMinutes = Math.ceil(
					decodeNumber(expectation.required_paid_minutes) * fraction
				);
				if (actualMinutes < expectedMinutes || actualDays < expectedDays) {
					issues.push({
						code: 'WORKLOAD_BELOW_TERMS',
						message:
							`The pay window assigns ${actualDays} work day(s) and ${actualMinutes} paid minute(s) ` +
							`for ${employment.employee_number}, below the employment terms of ${expectedDays} day(s) and ${expectedMinutes} minute(s).`,
						collection: 'employments',
						recordId: employment.id
					});
				}
			} else if (
				expectation.maximum_paid_minutes != null &&
				actualMinutes > Math.floor(decodeNumber(expectation.maximum_paid_minutes) * fraction)
			) {
				issues.push({
					code: 'WORKLOAD_ABOVE_TERMS',
					message:
						`The pay window assigns ${actualDays} work day(s) and ${actualMinutes} paid minute(s) ` +
						`for ${employment.employee_number}, above the employment cap of ${decodeNumber(expectation.maximum_paid_minutes)} minute(s).`,
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
