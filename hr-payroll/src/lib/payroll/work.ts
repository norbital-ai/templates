import { isRestLimit, type WorkRules } from '../datatypes/work_rules.js';
import type { ShiftPattern } from './run/configuration.js';
/** Work owns schedules, contracted wages, attendance, and the rates supplied to Leave. */
import { refuse } from '../refuse.js';
import type { WorkspaceRow } from '../rows.js';
import { offsetMinutesFor } from '../timezone.js';
import type { MoneyValue } from './run/rounding.js';
import { decodeNumber } from '../wire.js';
import {
	atWorksite,
	type CatalogueComponent,
	type Configuration
} from '../../lib/payroll/run/configuration.js';
import type { EmploymentBundle, GatheredRun } from '../../lib/payroll/run/gather.js';
import type { PayrollWorld } from './world.js';
import type { ComponentDefinition } from '../../lib/payroll/run/configuration.js';
import type { PayslipProration } from '../datatypes/payslip_proration.js';
import type { LeaveCharge } from '../datatypes/leave_charges.js';
import {
	classifyWageComparand,
	deriveStatutoryWages
} from '../../lib/payroll/run/statutory-wages.js';
import {
	daysBetween,
	inclusiveDays,
	intersectDays,
	monthBounds,
	monthDay,
	monthKey,
	completedYears,
	requiredDateKey,
	weekStart,
	type IsoDate,
	addDays
} from '../../lib/payroll/run/dates.js';
import type { InLieuSlice } from '../datatypes/payroll_trace.js';
import { employmentDates } from '../../lib/payroll/run/settlement.js';
import { leaveWindowOf } from '../leave/entitlement.js';
import { coversDate, live, readRange } from '../../lib/payroll/run/effective.js';
import { dayInstant, dateKey, isUtcIsoInstant } from '../iso-day.js';
import {
	evaluatePersonNumber,
	isEligible,
	personContext,
	scalarFacts,
	type PersonContext
} from '../../lib/payroll/run/eligibility.js';
import { stint } from '../employment-contract.js';
import {
	dailyWorkedHours,
	deriveDailyOvertime,
	ordinaryWorkedHours,
	nightWindowHours,
	type DailyOvertime
} from '../../lib/payroll/run/overtime.js';
import { nightAddsFor, priceWorkDay, workDayHolds, type WorkBandDay } from './work-bands.js';
import {
	absenceDayRate,
	ordinaryDayWage,
	ordinaryHourlyRate,
	ordinaryDivisorDays,
	type RateTerms
} from '../../lib/payroll/run/ordinary-rate.js';
import { prorationSegment } from '../../lib/payroll/run/proration.js';
import {
	contractAllowanceClass,
	contractAllowancesOn,
	listedAllowances
} from './contract-allowances.js';
import { cents } from '../../lib/payroll/run/rounding.js';
import { resolveSchedule } from '../../lib/payroll/run/schedule.js';
import { applicableLimits } from '../scheduling/work-limits.js';
import type { ScheduledDay } from '../../lib/payroll/run/schedule.js';
import { PAY_FREQUENCIES, type PayrollWindow } from '../../lib/payroll/run/period.js';
import {
	validateDailyOvertimeHoursLimit,
	validateDailyWorkLimit,
	validateOpenWorkDays,
	validateOvertimeLimits,
	validateUnplannedOvertime,
	validateRosteredExpectations,
	rosteredWorkCodeMaps,
	type RunIssue
} from '../../lib/payroll/run/validate.js';
import { leaveCoverage, unpaidLeaveDays } from '../leave/payroll.js';
import { activeTimeOff } from '../leave/activity.js';
import { previousWagePeriodOrdinaryRate } from './reference-wages.js';
import { describeVersion, settingsInForce } from '../jurisdiction_settings.js';
import { resolveFactValues } from '../declared-facts.js';
import type { FactKey } from '../datatypes/fact_keys.js';
import {
	patternAnchor,
	patternDaysPerWeek,
	patternRosterCodeId,
	patternWorkload,
	termPattern,
	termPatternRow,
	type PatternWorkload
} from '../scheduling/work-pattern.js';
import { clockMinutes, rosterCodeKind, workWindow } from '../scheduling/roster-code.js';
import { providedBreakMinutes } from '../scheduling/rest-break.js';

/**
 * The hours a punched day falls inside the regime's night window, for a break rule that owes a
 * longer rest at night (VN BLLĐ 2019 art.109(1)). Zero where the regime states no window.
 */
function nightHoursFor(
	entry: {
		readonly work_date: unknown;
		readonly worked_intervals?:
			readonly { readonly start: string; readonly end: string | null }[] | null | undefined;
	},
	day:
		| {
				readonly shift: {
					readonly start_time: string;
					readonly end_time: string;
					readonly crosses_midnight: boolean;
				} | null;
		  }
		| null
		| undefined,
	night: { readonly from: string; readonly to: string } | null | undefined,
	offset: number
): number {
	if (night == null || day == null) return 0;
	const measured = nightWindowHours(
		entry as Parameters<typeof nightWindowHours>[0],
		night,
		day.shift as Parameters<typeof nightWindowHours>[2],
		offset
	);
	return measured.ordinary + measured.overtime;
}
import type {
	Measurement,
	MeasureComponentOptions,
	MeasuredAdjustment,
	MeasuredEmployment,
	MeasureEmploymentOptions,
	PayRange
} from './family.js';
import { baseLine, settlementBucket } from './family.js';
import { bindingMinimumWage, minimumWageCovers } from './contribution.js';
import * as Predicate from 'effect/Predicate';
import { evaluateBoolean, evaluateNumber, expressionEngine } from '../expressions/evaluate.js';

/** A work-day input the day records, as a non-empty string (`work_days.facts`), or undefined. */
const dayFact = (
	row: { readonly facts?: unknown } | undefined,
	key: string
): string | undefined => {
	const value = (row?.facts as Readonly<Record<string, unknown>> | null | undefined)?.[key];
	return Predicate.isString(value) && value !== '' ? value : undefined;
};

/** Work resolves its catalogue from the version's rules. */
export function prepareWorkCatalogue(
	jurisdiction: Configuration['jurisdiction']
): Pick<
	Configuration,
	'work' | 'holidayRestPrecedence' | 'lastRestDayOnly' | 'limits' | 'breaks' | 'nightPremium'
> {
	const work: Configuration['work'] = {
		// the custom field's check admits only `WorkRules` (`lib/datatypes/work_rules.ts`)
		...(jurisdiction.work_rules as WorkRules),
		settings_id: jurisdiction.id,
		jurisdiction_code: jurisdiction.jurisdiction_code
	};
	return {
		work,
		holidayRestPrecedence: work.holiday_rest_precedence,
		lastRestDayOnly:
			work.last_rest_day_only === true || work.earlier_rest_day_work === 'RESOLVE_AS_OFF',
		// The hours limits payroll reports on; the rest-days limit is judged at the roster gate.
		limits: work.limits.filter((limit) => limit.measure !== 'CONSECUTIVE_WORK_DAYS'),
		breaks: work.breaks,
		nightPremium: work.night_premium ?? null
	};
}

/** Read current Work days and the monthly rosters of record over the span. */
export function prepareWorkInputs(options: {
	readonly world: PayrollWorld;
	readonly employmentIds: readonly string[];
	readonly complianceSpan: PayRange;
}): {
	readonly workDaysByEmployment: ReadonlyMap<string, EmploymentBundle['workDays']>;
	readonly rostersByEmployment: ReadonlyMap<string, EmploymentBundle['rosters']>;
	readonly wagePeriodsByEmployment: ReadonlyMap<string, EmploymentBundle['wagePeriods']>;
} {
	const { complianceSpan, world } = options;
	const employmentIds = new Set(options.employmentIds);
	const ours = <
		T extends { readonly approval_id?: string | null | undefined; readonly employment_id: string }
	>(
		rows: readonly T[]
	) => live(rows).filter((row) => employmentIds.has(row.employment_id));
	// The rosters of record: one row per person-month; a cycle straddling a month reads both.
	const months = new Set(monthsSpanned(complianceSpan));
	const workDays = new Map(
		ours(world.work_days)
			.filter((row) => {
				const day = dateKey(row.work_date);
				return day >= complianceSpan.start && day <= complianceSpan.end;
			})
			.map((row) => [row.id, row])
	);
	const rostersByEmployment = Map.groupBy(
		ours(world.rosters).filter((row) => months.has(row.period)),
		(row) => row.employment_id
	);
	return {
		workDaysByEmployment: Map.groupBy([...workDays.values()], (row) => row.employment_id),
		wagePeriodsByEmployment: Map.groupBy(
			ours(world.employment_wage_periods),
			(row) => row.employment_id
		),
		rostersByEmployment: new Map(
			[...rostersByEmployment].map(([id, rows]) => [id, rows.map((row) => monthBounds(row.period))])
		)
	};
}

/** Every calendar month a span touches, as YYYY-MM. */
function monthsSpanned(span: PayRange): string[] {
	const months: string[] = [];
	for (let month = span.start.slice(0, 7); month <= span.end.slice(0, 7);) {
		months.push(month);
		month = addDays(monthBounds(month).end, 1).slice(0, 7);
	}
	return months;
}

function termsIdentity(terms: EmploymentBundle['terms'][number]): string {
	return Predicate.isString(terms.id) && terms.id !== '' ? terms.id : termsSnapshotKey(terms);
}

export function termsAt(
	bundle: EmploymentBundle,
	date: IsoDate
): EmploymentBundle['terms'][number] {
	const row = bundle.termsHistory.find((candidate) => coversDate(candidate.effective_range, date));
	if (!row)
		throw new Error(
			`${bundle.employment.employee_number} has no employment terms effective on ${date}. ` +
				'Every day of the period a person is paid for must be covered by terms.'
		);
	return row;
}

function payFrequency(value: string | null): RateTerms['pay_frequency'] {
	const found = PAY_FREQUENCIES.find((candidate) => candidate === value);
	if (!found)
		throw new Error(
			`Employment terms state a pay frequency of "${value ?? 'nothing'}". Every wage must say how ` +
				'often it is paid before it can be spread over a period.'
		);
	return found;
}

function rosteredWorkload(options: {
	readonly days: EmploymentBundle['workDays'];
	readonly configuration: Configuration;
	readonly window: PayRange;
	/** The pattern's days a week: the roster's normal week is its shift × these days. */
	readonly daysPerWeek: number;
}): PatternWorkload {
	let workDays = 0;
	let paidMinutes = 0;
	for (const day of options.days) {
		// The planned half or nothing. A day carrying only attendance states no assignment, so it
		// contributes no scheduled load — which is the presence test the merged row is read by.
		const shiftId = day.shift_definition_id;
		if (shiftId == null) continue;
		const date = requiredDateKey(day.work_date, 'work_days.work_date');
		if (date < options.window.start || date > options.window.end) continue;
		const code = options.configuration.shiftById.get(shiftId);
		if (code == null)
			throw new Error(`Work day ${date} names roster code ${shiftId}, which is missing.`);
		if (rosterCodeKind(code.variant) !== 'WORK') continue;
		workDays += 1;
		paidMinutes += workWindow(code.variant)!.paid_minutes;
	}
	const referenceDays = inclusiveDays(options.window.start, options.window.end);
	// Zero expected WORK days is a valid month for ad-hoc workers: a DAILY- or HOURLY-paid
	// rostered employment with no rows earns zero, and the run does not throw. What the zero
	// cannot supply is a weekly pattern, so the rate fallback in `asRateTerms` resolves those.
	if (workDays === 0 || paidMinutes === 0)
		return {
			work_days: 0,
			paid_minutes: 0,
			reference_days: referenceDays,
			average_weekly_paid_minutes: 0
		};
	// A rostered person's normal day is the shift's paid hours, and the normal week is that day
	// over the contract's agreed days — never the minutes a month's roster happened to hold spread
	// over its calendar, which priced the same salary at a different hourly rate every month
	// (EA s.60I(1)(c): the ordinary rate over the normal hours of work).
	return {
		work_days: workDays,
		paid_minutes: paidMinutes,
		reference_days: referenceDays,
		average_weekly_paid_minutes: (paidMinutes / workDays) * options.daysPerWeek
	};
}

/** The terms row and the schedule that turn it into a weekly pattern workload. */
type TermsWorkloadOptions = {
	readonly terms: EmploymentBundle['terms'][number];
	readonly configuration: Configuration;
	readonly workDays: EmploymentBundle['workDays'];
	readonly window: PayRange;
};

function termsWorkload(options: TermsWorkloadOptions): PatternWorkload {
	const pattern = termPattern(options.terms, options.configuration.patternById);
	const declared = patternWorkload(pattern, options.configuration.shiftById);
	// A day cycle is the schedule itself. A declared expectation ("rostered 6 days") only
	// constrains the roster, which stays the record of what the week is: the rows price the
	// person, and the declaration stands in only where the month holds none.
	if (pattern != null && 'days' in pattern && declared != null) return declared;
	const rostered = rosteredWorkload({
		days: options.workDays,
		configuration: options.configuration,
		window: options.window,
		daysPerWeek: termsDaysPerWeek(options.terms, options.configuration)
	});
	return rostered.work_days > 0 ? rostered : (declared ?? rostered);
}

/** The days a week the terms' pattern works (`patternDaysPerWeek`); a terms row states none itself. */
function termsDaysPerWeek(
	terms: EmploymentBundle['terms'][number],
	configuration: Pick<Configuration, 'patternById' | 'shiftById'>
): number {
	const pattern = termPattern(terms, configuration.patternById);
	if (pattern == null)
		throw new Error(
			'Employment terms name no shift pattern; the pattern is where the contract’s week lives.'
		);
	return patternDaysPerWeek(pattern, configuration.shiftById);
}

function asRateTerms(
	terms: EmploymentBundle['terms'][number],
	workload: PatternWorkload,
	/** The pattern's days a week (`termsDaysPerWeek`). */
	days: number,
	/** The statute's normal day over this person, where the version states one; else infinite. */
	normalDayHours: number = Number.POSITIVE_INFINITY,
	/** The statute's normal week, where the version caps one (a `WEEK NORMAL_HOURS` limit); else infinite. */
	normalWeekHours: number = Number.POSITIVE_INFINITY,
	/** A contracted week below this belongs to the part-time hourly-rate rule. */
	partTimeBelowHours: number | null = null
): RateTerms {
	const salary = terms.base_salary;
	const frequency = payFrequency(terms.pay_frequency);
	// No scheduled days is no weekly pattern to annualise hours from: an ad-hoc DAILY or HOURLY
	// month with no rows, or a deferred joiner priced through `measureArrears` over a window their
	// roster does not reach. The week is then the contract's own (`ordinary_hours_per_week`), or
	// the statute's normal day over the agreed days; a contract that states neither and holds no
	// roster is refused by name — no figure of the engine's stands in for it.
	//
	// The days a week are the pattern's, never counted off a roster: a rostered person is not
	// ad hoc, and a divisor read off the days a roster happened to hold priced the same salary
	// at a different day rate every month.
	const contracted = terms.ordinary_hours_per_week == null ? null : terms.ordinary_hours_per_week;
	const rostered =
		workload.work_days > 0
			? workload.average_weekly_paid_minutes / 60
			: contracted != null && contracted > 0
				? contracted
				: Number.isFinite(normalDayHours)
					? normalDayHours * days
					: null;
	if (rostered == null)
		throw new Error(
			'A contract with no rostered days states its ordinary hours a week, or its version states a normal day.'
		);
	// The week the hourly rate is built on is the normal week, never longer than the statute's
	// normal day over the pattern's days: the hourly rate is the day's pay over the normal hours
	// of work (MY EA s.60I(1)(b), with s.60A(3)(c) capping those at the s.60A(1) limits), so a
	// ten-hour shift under an eight-hour normal day prices its hour at a day over eight, and the
	// two hours beyond are overtime on that rate — not a cheaper hour that pays its own overtime.
	// Where the version states the week a monthly wage's hour is built on
	// (`work_rules.rate_week_hours`), a monthly-rated hour is on that week whatever the contract's:
	// SG EA Fourth Schedule uses 44; the Part-Time Employees Regulations use the contract's own
	// week below the version's statutory part-time boundary. Malaysia states no fixed week.
	if (Number.isFinite(normalWeekHours) && partTimeBelowHours == null)
		throw new Error('A fixed hourly-rate week requires a sealed part-time boundary.');
	const contractWeek = contracted != null && contracted > 0 ? contracted : rostered;
	if (partTimeBelowHours != null) {
		if (!Number.isFinite(partTimeBelowHours) || partTimeBelowHours <= 0)
			throw new Error('The sealed part-time weekly-hour boundary must be positive.');
		const underPartTimeBoundary = contractWeek < partTimeBelowHours;
		if ((terms.employment_type === 'PART_TIME') !== underPartTimeBoundary)
			throw new Error('Employment part-time status conflicts with contracted weekly hours.');
	}
	const fixedWeek =
		(frequency === 'MONTHLY' || frequency === 'SEMI_MONTHLY') &&
		partTimeBelowHours != null &&
		contractWeek >= partTimeBelowHours;
	const hours =
		fixedWeek && Number.isFinite(normalWeekHours)
			? normalWeekHours
			: Math.min(contractWeek, rostered, normalDayHours * days, normalWeekHours);
	return {
		base_salary: { value: salary, currency: terms.currency },
		pay_frequency: frequency,
		ordinary_hours_per_week: hours,
		working_days_per_week: days
	};
}

/**
 * The immutable label a settled proration segment carries instead of a terms id.
 *
 * An output is a frozen fact and a naked uuid with no foreign key is not a relationship, so the
 * segment composes the terms' own title with the day its effective range opens — the job title when
 * there is one, the employment type always, and the day the terms begin, which the exclusion rule
 * makes unique per employment. It is a label with enough identity to re-read the segment against,
 * not a relationship.
 */
function termsSnapshotKey(terms: EmploymentBundle['terms'][number]): string {
	const start = dateKey(readRange(terms.effective_range)?.start);
	const title =
		terms.job_title == null || terms.job_title === '' ? terms.employment_type : terms.job_title;
	return `${title} @ ${start} · ${(terms.base_salary ?? 0).toFixed(2)}`;
}

/** Prepare schedule and rates before money-family totals determine statutory overtime coverage. */
export function prepareWorkContext(
	options: Pick<MeasureEmploymentOptions, 'bundle' | 'configuration' | 'salary'> & {
		readonly employed: PayRange;
		/** Consumed dated wage history, recorded for the payslip capture. */
		readonly referenceWageIds?: Set<string> | undefined;
	}
) {
	const { bundle, configuration, employed } = options;
	const employmentForPerson = () =>
		stint(bundle.employment, configuration.jurisdiction.exit_facts ?? []);
	const attendance = bundle.attendance;
	const wageDays = bundle.wageDays ?? employed;
	const closingTerms = termsAt(bundle, employed.end);
	const closingWorkload = termsWorkload({
		terms: closingTerms,
		configuration,
		workDays: bundle.workDays,
		window: options.salary
	});

	// ── schedule across the full calendar months touched by the settlement cutoff ───────────────
	const complianceWindow: PayRange = {
		start: monthBounds(monthKey(attendance.start)).start,
		end: monthBounds(monthKey(attendance.end)).end
	};
	const attendanceDays = daysBetween(complianceWindow.start, complianceWindow.end);
	// The statute's normal day, where the version states one (`work_rules.normal_hours`): a shift
	// longer than it is a normal day plus overtime. Read over the person on the closing terms.
	const normalHoursRule = (configuration.work.normal_hours ?? '').trim();
	const shiftDayRule = (configuration.work.shift_day_hours ?? '').trim();
	const redistributedRule = (configuration.work.redistributed_hours ?? '').trim();
	const normalHoursCapOn = (
		terms: EmploymentBundle['terms'][number],
		workload: PatternWorkload,
		date: IsoDate
	) =>
		normalHoursRule === ''
			? Number.POSITIVE_INFINITY
			: evaluatePersonNumber(
					normalHoursRule,
					personContext({
						employee: bundle.employee,
						employment: employmentForPerson(),
						terms,
						week: {
							ordinary_hours_per_week:
								workload.work_days > 0
									? workload.average_weekly_paid_minutes / 60
									: (terms.ordinary_hours_per_week ?? 0),
							working_days_per_week: termsDaysPerWeek(terms, configuration)
						},
						children: bundle.children,
						company: configuration.company,
						asOf: date
					})
				);
	const normalHoursCap = normalHoursCapOn(closingTerms, closingWorkload, options.salary.end);
	// The week the version builds the hourly rate on, where it states one (SG EA Fourth Schedule:
	// 52 × 44 for a monthly-rated full-time employee); a version whose hour is the day over the daily normal
	// hours (MY s.60I(1)(b)) states none.
	const normalWeekCap = configuration.work.rate_week_hours ?? Number.POSITIVE_INFINITY;
	const rateTerms = asRateTerms(
		closingTerms,
		closingWorkload,
		termsDaysPerWeek(closingTerms, configuration),
		normalHoursCap,
		normalWeekCap,
		configuration.work.part_time_week_hours_below ?? null
	);
	const currency = rateTerms.base_salary.currency;
	const workDayByDate = new Map(
		bundle.workDays.map((day) => [requiredDateKey(day.work_date, 'work_days.work_date'), day])
	);
	const scheduleTermsAt = (date: IsoDate) => {
		const row =
			bundle.termsHistory.find((candidate) => coversDate(candidate.effective_range, date)) ??
			closingTerms;
		const workload = termsWorkload({
			terms: row,
			configuration,
			workDays: bundle.workDays,
			window: complianceWindow
		});
		const dayCap = normalHoursCapOn(row, workload, date);
		const statedDay = Math.min(
			dayCap,
			statedDayHours(row, termsDaysPerWeek(row, configuration)) ?? Number.POSITIVE_INFINITY
		);
		const patternRow = termPatternRow(row, configuration.patternById);
		const dayRow = workDayByDate.get(date) as
			((typeof bundle.workDays)[number] & { readonly fact_keys?: readonly string[] }) | undefined;
		return {
			work_pattern: patternRow?.pattern ?? null,
			pattern_anchor: patternAnchor(patternRow),
			// The normal day of a day with no shift of its own (a rest day's halves, an unrostered
			// clocked day): the contract's stated day, else the roster's usual day, else the
			// statute's — never a figure of the engine's.
			normal_daily_hours: Math.min(
				dayCap,
				workload.work_days > 0
					? workload.paid_minutes / workload.work_days / 60
					: contractDayHours(row, termsDaysPerWeek(row, configuration), dayCap)
			),
			// A rostered shift is its own normal day up to the statute's (and the contract's stated
			// day where it states one) — never up to the roster's average: a roster mixing 7.5-hour
			// and 9-hour shifts averages 8.2, and every 9-hour shift was earning an hour of overtime
			// MY s.60A(1)'s proviso does not owe.
			// Where the version lets an agreement move the day (`work_rules.shift_day_hours`), its
			// rule decides, reading the stated day as its default.
			shift_day_hours:
				shiftDayRule === ''
					? statedDay
					: evaluateNumber(expressionEngine, shiftDayRule, {
							person: personContext({
								employee: bundle.employee,
								employment: employmentForPerson(),
								terms: row,
								week: {
									ordinary_hours_per_week:
										workload.work_days > 0
											? workload.average_weekly_paid_minutes / 60
											: (row.ordinary_hours_per_week ?? 0),
									working_days_per_week: termsDaysPerWeek(row, configuration)
								},
								children: bundle.children,
								company: configuration.company,
								asOf: date
							}),
							date,
							day_facts: scalarFacts(dayRow?.facts),
							day_fact_keys: dayRow?.fact_keys ?? Object.keys(scalarFacts(dayRow?.facts)),
							stated_day_hours: statedDay
						})
		};
	};
	const schedule = resolveSchedule({
		window: complianceWindow,
		dates: attendanceDays,
		terms: scheduleTermsAt,
		workDays: bundle.workDays,
		rosters: bundle.rosters,
		configuration
	});
	// The weekly limits payroll judges itself (`limits[].enforced_at_payroll`), over whole weeks.
	const enforcedWeekly = configuration.limits.filter(
		(limit) => limit.enforced_at_payroll === true && limit.period === 'WEEK'
	);
	const weeklyNormalLimits = enforcedWeekly.filter((limit) => limit.measure === 'NORMAL_HOURS');
	let weeklySchedule = new Map<IsoDate, ScheduledDay>();
	if (enforcedWeekly.length > 0) {
		const employment = employmentDates(bundle.employment);
		const first = weekStart(complianceWindow.start);
		const last = addDays(weekStart(complianceWindow.end), 6);
		const weeklyWindow = {
			start: employment.hire > first ? employment.hire : first,
			end: employment.exit != null && employment.exit < last ? employment.exit : last
		};
		weeklySchedule =
			weeklyWindow.start <= weeklyWindow.end
				? resolveSchedule({
						window: weeklyWindow,
						dates: daysBetween(weeklyWindow.start, weeklyWindow.end),
						terms: scheduleTermsAt,
						workDays: bundle.workDays,
						rosters: bundle.rosters,
						configuration
					})
				: new Map<IsoDate, ScheduledDay>();
	}
	if (weeklyNormalLimits.length > 0) {
		const weeks = new Map<
			string,
			{
				hours: number;
				redistributed: number;
				shorter: number;
				limits: Map<string, (typeof weeklyNormalLimits)[number]>;
			}
		>();
		for (const [date, day] of weeklySchedule) {
			if (day.shift == null || day.dayType !== 'ORDINARY') continue;
			const terms = termsAt(bundle, date);
			const week = weekStart(date);
			const totals = weeks.get(week) ?? {
				hours: 0,
				redistributed: 0,
				shorter: 0,
				limits: new Map<string, (typeof weeklyNormalLimits)[number]>()
			};
			totals.hours += day.normalHours;
			const person = personContext({
				employee: bundle.employee,
				employment: employmentForPerson(),
				terms,
				week: {
					ordinary_hours_per_week: decodeNumber(terms.ordinary_hours_per_week ?? 0),
					working_days_per_week: termsDaysPerWeek(terms, configuration)
				},
				children: bundle.children,
				company: configuration.company,
				asOf: date
			});
			for (const limit of applicableLimits(weeklyNormalLimits, person))
				totals.limits.set(limit.key, limit);
			// The hours this day moves within its week (`work_rules.redistributed_hours`): above the
			// normal day they must be given back by shorter days of the same week.
			if (redistributedRule !== '') {
				const row = workDayByDate.get(date) as
					| ((typeof bundle.workDays)[number] & { readonly fact_keys?: readonly string[] })
					| undefined;
				const moved = evaluateNumber(expressionEngine, redistributedRule, {
					person,
					date,
					day_type: day.dayType,
					normal_hours: day.normalHours,
					day_facts: scalarFacts(row?.facts),
					day_fact_keys: row?.fact_keys ?? Object.keys(scalarFacts(row?.facts))
				});
				if (moved > 0) totals.redistributed += moved;
				else totals.shorter -= moved;
			}
			weeks.set(week, totals);
		}
		for (const [week, totals] of weeks) {
			if (totals.redistributed > totals.shorter + 1e-9)
				refuse(
					`${bundle.employment.employee_number} has ${totals.redistributed.toFixed(2)} redistributed normal hours above the normal day in the week of ${week}, but only ${totals.shorter.toFixed(2)} shorter-day hours to offset them.`
				);
			for (const limit of [...totals.limits.values()].toSorted(
				(left, right) => left.max_hours - right.max_hours
			))
				if (totals.hours > limit.max_hours + 1e-9)
					refuse(
						`${bundle.employment.employee_number} has ${totals.hours.toFixed(2)} normal hours in the week of ${week}, above the ${limit.max_hours}-hour limit "${limit.key}".`
					);
		}
	}

	// The rest limits payroll re-judges over the compliance span (`enforced_at_payroll`).
	for (const restLimit of configuration.work.limits
		.filter(isRestLimit)
		.filter((limit) => limit.enforced_at_payroll === true)) {
		const employment = employmentDates(bundle.employment);
		const before = addDays(complianceWindow.start, -restLimit.max_days);
		const first = employment.hire > before ? employment.hire : before;
		const last =
			employment.exit != null && employment.exit < complianceWindow.end
				? employment.exit
				: complianceWindow.end;
		const plannedByDate = new Map(
			bundle.workDays.map((row) => [
				requiredDateKey(row.work_date, 'work_days.work_date'),
				row.shift_definition_id
			])
		);
		let run = 0;
		let runStart = '';
		for (const date of first <= last ? daysBetween(first, last) : []) {
			const term = termsAt(bundle, date);
			const pattern = termPatternRow(term, configuration.patternById);
			const codeId =
				plannedByDate.get(date) ??
				patternRosterCodeId(pattern?.pattern ?? null, date, patternAnchor(pattern));
			const code = codeId == null ? null : configuration.shiftById.get(codeId);
			if (codeId != null && code == null) refuse(`Roster code ${codeId} is missing on ${date}.`);
			const kind = code == null ? null : rosterCodeKind(code.variant);
			if (kind === 'REST' || (restLimit.discharged_by === 'REST_OR_OFF' && kind !== 'WORK'))
				run = 0;
			if (kind === 'WORK') {
				if (run === 0) runStart = date;
				run += 1;
			}
			if (run > restLimit.max_days && date >= complianceWindow.start)
				refuse(
					`${bundle.employment.employee_number} has ${run} consecutive worked days from ${runStart} through ${date}; ${restLimit.key} permits ${restLimit.max_days} before a REST day.`
				);
		}
	}
	// Proration asks how many days the person was meant to work, not how many they attended. Source
	// rosters mark an approved leave day OFF because there is no shift to clock; using that mark as
	// the divisor makes a whole-month absence have zero working days and therefore no price. Remove
	// those leave-day marks so the contractual week supplies the missed schedule, while retaining
	// genuine roster rotations on every other day. Resolve each requested window independently:
	// salary proration needs the whole calendar month even though overtime only reads the cutoff
	// attendance window, and deferred joiners can ask for the previous month.
	const coverage = leaveCoverage(bundle.leave, complianceWindow);
	// ── person-day protections (`work_rules.day_rules`), judged on every scheduled or attended day ──
	const nightWindow = configuration.work.night_window ?? null;
	const born = dateKey(bundle.employee.date_of_birth);
	/**
	 * One person-day as the day rules and the overtime-consent rule read it, or null where it was
	 * neither scheduled nor attended: its work spans (the punches, else the presumed shift split at
	 * its timed break), the rests between them, the night window's first instant, and the person.
	 */
	const dayRuleContext = (date: IsoDate, day: ScheduledDay): Record<string, unknown> | null => {
		const row = workDayByDate.get(date);
		const intervals = row?.worked_intervals;
		const shift = day.shift;
		const expected =
			day.dayType === 'ORDINARY' &&
			shift != null &&
			day.normalHours * (1 - (coverage.days[date] ?? 0)) > 0;
		if (!expected && (intervals?.length ?? 0) === 0) return null;
		const offset = offsetMinutesFor(configuration.jurisdiction.payroll.timezone, date);
		const midnight = Date.parse(`${date}T00:00:00.000Z`) - offset * 60_000;
		const presumed = intervals == null ? shift : null;
		const shiftStart = presumed == null ? 0 : midnight + clockMinutes(presumed.start_time) * 60_000;
		let spans = (
			presumed == null
				? (intervals ?? []).map((interval) => ({
						start: Date.parse(interval.start),
						end: Date.parse(interval.end ?? '')
					}))
				: [{ start: shiftStart, end: shiftStart + presumed.elapsed_minutes * 60_000 }]
		).toSorted((left, right) => left.start - right.start);
		for (const [index, span] of spans.entries())
			if (
				!Number.isFinite(span.start) ||
				!Number.isFinite(span.end) ||
				span.end <= span.start ||
				(index > 0 && span.start < spans[index - 1]!.end)
			)
				refuse(
					`${bundle.employment.employee_number} needs closed, non-overlapping work intervals on ${date}.`
				);
		if (presumed?.break_start_time != null && spans.length === 1) {
			let breakClock = clockMinutes(presumed.break_start_time);
			if (breakClock < clockMinutes(presumed.start_time)) breakClock += 1440;
			const breakStart = midnight + breakClock * 60_000;
			const breakEnd = breakStart + presumed.break_minutes * 60_000;
			const whole = spans[0]!;
			if (whole.start < breakStart && breakEnd < whole.end)
				spans = [
					{ start: whole.start, end: breakStart },
					{ start: breakEnd, end: whole.end }
				];
		}
		const gaps = spans.slice(1).map((span, index) => (span.start - spans[index]!.end) / 60_000);
		const spanHours = spans.map((span) => (span.end - span.start) / 3_600_000);
		const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
		const workedHours = sum(spanHours);
		const hourRest = gaps.findIndex((minutes) => minutes >= 60);
		let restBeforeOvertime = 0;
		if (day.dayType === 'ORDINARY' && workedHours > day.normalHours) {
			let normalLeft = day.normalHours * 3_600_000;
			for (const [index, span] of spans.entries()) {
				const duration = span.end - span.start;
				if (normalLeft > duration) {
					normalLeft -= duration;
					continue;
				}
				const normalEnd = span.start + normalLeft;
				const overtimeStart =
					normalLeft < duration ? normalEnd : (spans[index + 1]?.start ?? normalEnd);
				restBeforeOvertime = (overtimeStart - normalEnd) / 60_000;
				break;
			}
		}
		const firstNight =
			nightWindow == null
				? Number.POSITIVE_INFINITY
				: Math.min(
						...spans.flatMap((span) =>
							[-1, 0, 1].flatMap((shiftDays) => {
								const startClock = clockMinutes(nightWindow.start);
								const endClock = clockMinutes(nightWindow.end);
								const from = midnight + (shiftDays * 1440 + startClock) * 60_000;
								const to =
									midnight +
									(shiftDays * 1440 + endClock + (endClock <= startClock ? 1440 : 0)) * 60_000;
								return span.end > from && span.start < to ? [Math.max(span.start, from)] : [];
							})
						)
					);
		// A presumed day is its shift's paid hours; an attended one the hours its punches hold.
		const paidHours = presumed == null ? workedHours : presumed.paid_minutes / 60;
		const round = (value: number) => Math.round(value * 1e6) / 1e6;
		const terms = termsAt(bundle, date);
		const recorded = Object.fromEntries(
			Object.entries(row?.facts ?? {}).map(([key, value]) => [
				key,
				Predicate.isString(value) && isUtcIsoInstant(value) ? new Date(value).toISOString() : value
			])
		);
		// A day records only what it states; the version's other declared inputs read as their defaults.
		const declared = ((
			settingsInForce(configuration.lineageVersions, configuration.jurisdiction.code, date) ??
			configuration.jurisdiction
		).work_day_facts ?? []) as readonly FactKey[];
		const facts = { ...resolveFactValues(declared, {}, 'Work day', false), ...recorded };
		return {
			person: personContext({
				employee: bundle.employee,
				employment: employmentForPerson(),
				terms,
				week: {
					ordinary_hours_per_week: decodeNumber(terms.ordinary_hours_per_week ?? 0),
					working_days_per_week: termsDaysPerWeek(terms, configuration)
				},
				children: bundle.children,
				company: configuration.company,
				asOf: date
			}),
			date,
			day_type: day.dayType,
			normal_hours: day.normalHours,
			worked_hours: round(workedHours),
			day_facts: facts,
			day_fact_keys:
				(row as { readonly fact_keys?: readonly string[] } | undefined)?.fact_keys ??
				Object.keys(recorded),
			age_years: born === '' ? 0 : completedYears(born, date),
			attendance_recorded: intervals != null,
			first_work_at: spans.length === 0 ? '' : new Date(spans[0]!.start).toISOString(),
			night_worked: Number.isFinite(firstNight),
			first_night_at: Number.isFinite(firstNight) ? new Date(firstNight).toISOString() : '',
			holiday_work: day.dayType !== 'ORDINARY' && spans.length > 0,
			overtime_work: day.dayType === 'ORDINARY' && paidHours > day.normalHours + 1e-9,
			rest_minutes_total: round(
				presumed == null ? sum(gaps) : Math.max(sum(gaps), presumed.break_minutes)
			),
			longest_rest_minutes: round(Math.max(0, ...gaps)),
			longest_run_hours: round(Math.max(0, ...spanHours)),
			run_hours_before_first_hour_rest: round(
				sum(spanHours.slice(0, hourRest < 0 ? spanHours.length : hourRest + 1))
			),
			rest_before_overtime_minutes: round(restBeforeOvertime),
			shift_hours: shift == null ? 0 : shift.paid_minutes / 60,
			shift_start_at:
				shift == null
					? ''
					: new Date(midnight + clockMinutes(shift.start_time) * 60_000).toISOString()
		};
	};
	const dayRules = configuration.work.day_rules ?? [];
	if (dayRules.length > 0) {
		const employment = employmentDates(bundle.employment);
		for (const [date, day] of schedule) {
			if (
				date < employment.hire ||
				(employment.exit != null && date > employment.exit) ||
				!(
					(date >= wageDays.start && date <= wageDays.end) ||
					(date >= attendance.start && date <= attendance.end)
				)
			)
				continue;
			const context = dayRuleContext(date, day);
			if (context == null) continue;
			const broken = dayRules.find((rule) => evaluateBoolean(expressionEngine, rule.when, context));
			if (broken != null)
				refuse(
					`${bundle.employment.employee_number} ${broken.message} on ${date}${broken.authority ? ` (${broken.authority})` : ''}.`
				);
		}
	}
	const takenLeaveDates = new Set(Object.keys(coverage.days));
	const prorationWorkDays = bundle.workDays.filter(
		(row) => !takenLeaveDates.has(requiredDateKey(row.work_date, 'work_days.work_date'))
	);
	const prorationScheduleCache = new Map<string, ReturnType<typeof resolveSchedule>>();
	const prorationScheduleIn = (window: PayRange) => {
		const key = `${window.start}:${window.end}`;
		const cached = prorationScheduleCache.get(key);
		if (cached != null) return cached;
		const dates = daysBetween(window.start, window.end);
		const prorationSchedule = resolveSchedule({
			window,
			dates,
			terms: scheduleTermsAt,
			workDays: prorationWorkDays,
			rosters: bundle.rosters,
			configuration
		});
		prorationScheduleCache.set(key, prorationSchedule);
		return prorationSchedule;
	};
	const isOrdinaryWorkingDay = (date: string): boolean => {
		const day = prorationScheduleIn(monthBounds(monthKey(date))).get(date);
		return day?.dayType === 'ORDINARY' && day.shift != null;
	};
	const workingDaysIn = (window: PayRange): number => {
		const dates = daysBetween(window.start, window.end);
		const prorationSchedule = prorationScheduleIn(window);
		// A public holiday that falls on a scheduled working day is a working day, in the numerator
		// and the divisor alike (SG EA s.20A / MOM: the days required to work "include public
		// holidays"; VN Decree 145/2020 art.54(1)(a) counts the same). One that falls on a rest day
		// is neither.
		// A day the contract requires five hours or fewer counts as half (SG EA s.20A(2)), where the
		// version says so — but a public holiday on such a day pays a full day (s.88(7)), so it
		// weighs one.
		const halfHours = configuration.jurisdiction.payroll.short_day_half_hours ?? null;
		const days = dates.reduce((total, date) => {
			const day = prorationSchedule.get(date);
			const working =
				day?.dayType === 'ORDINARY' || (day?.dayType === 'PUBLIC_HOLIDAY' && day.shift != null);
			if (!working) return total;
			const short =
				halfHours != null &&
				day?.dayType === 'ORDINARY' &&
				day.shift != null &&
				day.shift.paid_minutes <= halfHours * 60;
			return total + (short ? 0.5 : 1);
		}, 0);
		return days;
	};

	/**
	 * A day of pay *withheld* is not a day of pay *earned*, and the two use different divisors.
	 *
	 * `ordinary_day_wage` divides by `ordinary_rate.divisor` — 26 in Malaysia, EA s.60I — because that
	 * is the basis the Act sets for what an extra day of work is worth. Withholding pay for a day not
	 * worked is proration, and proration is `work_rules.proration`: the month's calendar days here,
	 * working days elsewhere. Valuing an absence at the overtime divisor over-deducts by the ratio
	 * between them — 31/26, about 19%, on every employee with unpaid leave.
	 *
	 * Rounded to the cent before it is multiplied by the day count, not after, which is what the
	 * source system does and what reproduces its figures exactly.
	 */
	const subject = personContext({
		employee: bundle.employee,
		employment: employmentForPerson(),
		// The standing allowances in force, so a divisor can price the hour over the monthly wage
		// (ID PP 35/2021 art.32: 1/173 of basic plus fixed allowances).
		fixedAllowances: contractAllowancesOn(bundle, configuration, options.salary.end),
		terms: closingTerms,
		// The working week the roster produced, so a rate row can turn on it. The Philippine day
		// factor is 261 annual days for a five-day week and 313 for a six-day one, which is
		// employee-level law: it cannot be a company-wide divisor, and it is not the engine's to
		// know either — the Work states one rate row per week shape and the predicate picks.
		week: {
			ordinary_hours_per_week: rateTerms.ordinary_hours_per_week,
			working_days_per_week: rateTerms.working_days_per_week
		},
		children: bundle.children,
		company: configuration.company,
		// The pay month's working days, so a divisor expression can name `period.working_days`.
		period: { working_days: workingDaysIn(monthBounds(monthKey(options.salary.start))) },
		asOf: options.salary.end
	});
	const absenceDayWage = absenceDayRate({
		terms: rateTerms,
		work: configuration.work,
		person: subject,
		period: options.salary,
		workingDaysIn
	});

	// The overtime hour is the jurisdiction's ordinary hourly rate and nothing a company chooses:
	// the version's own divisor expression, evaluated over this person.
	const divisorDays = ordinaryDivisorDays({
		expression: configuration.work.ordinary_divisor_days,
		person: subject,
		employeeNumber: bundle.employment.employee_number
	});
	// The days a month a daily wage is taken to before the divisor prices its hour, where stated.
	const dailyMonthRule = (configuration.work.daily_month_days ?? '').trim();
	const dailyMonthDays = (person: PersonContext) =>
		dailyMonthRule === '' ? undefined : evaluatePersonNumber(dailyMonthRule, person);
	const hourlyRate = ordinaryHourlyRate(rateTerms, divisorDays, dailyMonthDays(subject));
	const dayWage = ordinaryDayWage(rateTerms, divisorDays);
	// Resolve salary, allowances and hours on the day worked, including salary changes inside a month.
	const ratesByDate = new Map<
		string,
		{ ordinaryHour: number; dayWage: number; person: PersonContext }
	>();
	const ratesOn = (date: IsoDate) => {
		const cached = ratesByDate.get(date);
		if (cached != null) return cached;
		const term = termsAt(bundle, date);
		const month = monthBounds(monthKey(date));
		const days = termsDaysPerWeek(term, configuration);
		const workload = termsWorkload({
			terms: term,
			configuration,
			workDays: bundle.workDays,
			window: month
		});
		const personInput = {
			employee: bundle.employee,
			employment: employmentForPerson(),
			terms: term,
			fixedAllowances: contractAllowancesOn(bundle, configuration, date),
			// The s.2 "gross rate of pay" allowances: the contract's, less the classes the version
			// names (SG EA s.2(e): travelling, food or housing allowances).
			grossAllowances: contractAllowancesOn(
				bundle,
				configuration,
				date,
				undefined,
				configuration.work.gross_excluded_allowances ?? undefined
			),
			children: bundle.children,
			company: configuration.company,
			week: {
				ordinary_hours_per_week:
					term.ordinary_hours_per_week ?? workload.average_weekly_paid_minutes / 60,
				working_days_per_week: days
			},
			period: { working_days: workingDaysIn(month) },
			asOf: date
		};
		const datedPerson = personContext(personInput);
		const cap = normalHoursCapOn(term, workload, date);
		const datedTerms = asRateTerms(
			term,
			workload,
			days,
			cap,
			normalWeekCap,
			configuration.work.part_time_week_hours_below ?? null
		);
		const rateWeek = {
			ordinary_hours_per_week: datedTerms.ordinary_hours_per_week,
			working_days_per_week: days
		};
		const divisor = ordinaryDivisorDays({
			expression: configuration.work.ordinary_divisor_days,
			person: {
				...datedPerson,
				terms: { ...datedPerson.terms, ordinary_hours_per_week: rateWeek.ordinary_hours_per_week }
			},
			employeeNumber: bundle.employment.employee_number
		});
		// The work day reads the rate a daily, hourly or weekly contract states as its month on the
		// divisor just evaluated (`terms.monthly_basic`, `terms.ordinary_day`), as documented.
		const person = personContext({ ...personInput, week: rateWeek, divisorDays: divisor });
		let ordinaryHour = ordinaryHourlyRate(datedTerms, divisor, dailyMonthDays(person));
		let dayWage = ordinaryDayWage(datedTerms, divisor);
		// A verified dated wage record replaces the current contract's reconstruction where the
		// version says so (MY s.60I(1C): the preceding wage period's earnings over its worked days).
		// A latest-month normal-wage reference is the leave cash-out's (TW 施行細則 §24-1) alone: the
		// overtime hour is the current month's normal wage (勞基法 §24), which the contract states.
		const reference = configuration.work.ordinary_rate_reference;
		if (
			reference?.reference === 'PREVIOUS_WAGE_PERIOD' &&
			reference.pay_frequencies.some((frequency) => frequency === datedTerms.pay_frequency)
		) {
			const normalDailyHours =
				datedTerms.working_days_per_week === 0
					? 0
					: datedTerms.ordinary_hours_per_week / datedTerms.working_days_per_week;
			if (!(normalDailyHours > 0))
				throw new Error('Ordinary-rate reference requires positive contractual normal hours.');
			const prior = previousWagePeriodOrdinaryRate({
				periods: bundle.wagePeriods ?? [],
				currentPeriodStart: monthBounds(monthKey(date)).start,
				currency
			});
			dayWage = prior.ordinaryDay;
			ordinaryHour = prior.ordinaryDay / normalDailyHours;
			options.referenceWageIds?.add(prior.row.id);
		}
		const rates = {
			ordinaryHour,
			dayWage,
			person
		};
		ratesByDate.set(date, rates);
		return rates;
	};

	const chargeTerms = (charge: LeaveCharge) => {
		const term = bundle.termsHistory.find(
			(row) => row.id === charge.employment_term_id && coversDate(row.effective_range, charge.date)
		);
		if (!term) throw new Error(`Leave has no captured employment terms on ${charge.date}.`);
		const period = monthBounds(monthKey(charge.date));
		const workload = termsWorkload({
			terms: term,
			configuration,
			workDays: bundle.workDays,
			window: period
		});
		const terms = asRateTerms(
			term,
			workload,
			termsDaysPerWeek(term, configuration),
			normalHoursCapOn(term, workload, charge.date),
			normalWeekCap,
			configuration.work.part_time_week_hours_below ?? null
		);
		if (terms.base_salary.currency !== currency)
			throw new Error('Leave absence rate has a different currency from payroll.');
		return { term, period, terms };
	};
	/** A monthly term's unpaid days never take more than its month's salary: a whole month unpaid pays nothing. */
	const absenceCeiling = (charge: LeaveCharge): number => {
		const { terms } = chargeTerms(charge);
		return terms.pay_frequency === 'MONTHLY' ? terms.base_salary.value : Number.POSITIVE_INFINITY;
	};
	const absenceRate = (charge: LeaveCharge): number => {
		const { period, terms } = chargeTerms(charge);
		if (terms.pay_frequency === 'DAILY') return terms.base_salary.value;
		if (terms.pay_frequency === 'HOURLY') {
			const shift =
				charge.shift_definition_id == null
					? null
					: configuration.shiftById.get(charge.shift_definition_id);
			const hours = shift == null ? null : workWindow(shift.variant);
			const normal = terms.ordinary_hours_per_week / terms.working_days_per_week;
			if (hours == null && !(normal > 0))
				throw new Error('Hourly calendar Leave needs positive normal daily hours.');
			return terms.base_salary.value * (hours == null ? normal : hours.paid_minutes / 60);
		}
		return absenceDayRate({
			terms,
			work: configuration.work,
			person: subject,
			period,
			workingDaysIn
		});
	};
	const absenceHourlyRate = (charge: LeaveCharge): number => {
		const term = bundle.termsHistory.find(
			(row) => row.id === charge.employment_term_id && coversDate(row.effective_range, charge.date)
		);
		if (!term) refuse(`Hourly Leave has no captured employment terms on ${charge.date}.`);
		if (term.currency !== currency) refuse('Hourly Leave has a different currency from payroll.');
		const workload = termsWorkload({
			terms: term,
			configuration,
			workDays: bundle.workDays,
			window: monthBounds(monthKey(charge.date))
		});
		const weeklyHours = term.ordinary_hours_per_week ?? workload.average_weekly_paid_minutes / 60;
		const days = termsDaysPerWeek(term, configuration);
		if (!(weeklyHours > 0) || !(days > 0))
			refuse('Hourly Leave needs positive contracted weekly hours and working days.');
		const grossExcluded = configuration.work.gross_excluded_allowances ?? [];
		for (const listed of listedAllowances(term)) {
			const component = contractAllowanceClass(configuration, listed.catalogue_id);
			if (
				listed.amount > 0 &&
				component?.destination === 'PAY' &&
				component.direction === 'ADD' &&
				(component.npl_prorates ?? configuration.jurisdiction.payroll.allowance_npl_prorates) ===
					false &&
				!grossExcluded.includes(component.code)
			)
				refuse(`Hourly Leave needs gross-rate classification for allowance ${component.code}.`);
		}
		const allowances = contractAllowancesOn(
			bundle,
			configuration,
			charge.date,
			undefined,
			grossExcluded
		);
		const allowanceHour = (12 * allowances) / (52 * weeklyHours);
		const basic = term.base_salary;
		const frequency = payFrequency(term.pay_frequency);
		if (frequency === 'HOURLY') return basic + allowanceHour;
		if (frequency === 'DAILY') return basic / (weeklyHours / days) + allowanceHour;
		if (frequency === 'WEEKLY') return basic / weeklyHours + allowanceHour;
		return (12 * basic) / (52 * weeklyHours) + allowanceHour;
	};
	const outpatientSickExcludedRate = (charge: LeaveCharge): number => {
		const term = bundle.termsHistory.find(
			(row) => row.id === charge.employment_term_id && coversDate(row.effective_range, charge.date)
		);
		if (!term) refuse(`Outpatient sick leave has no captured employment terms on ${charge.date}.`);
		if (term.currency !== currency)
			refuse('Outpatient sick leave has a different currency from payroll.');
		if (
			configuration.catalogueComponents.some(
				(component) =>
					component.family === 'ALLOWANCE' &&
					component.owed === true &&
					component.destination === 'PAY' &&
					component.direction === 'ADD' &&
					component.outpatient_sick_pay !== 'INCLUDE'
			)
		)
			refuse('Outpatient sick leave needs an owed allowance priced before its shift exclusion.');
		let excluded = 0;
		for (const listed of listedAllowances(term)) {
			const component = contractAllowanceClass(configuration, listed.catalogue_id);
			if (
				listed.amount <= 0 ||
				component?.destination !== 'PAY' ||
				component.direction !== 'ADD' ||
				(configuration.work.gross_excluded_allowances ?? []).includes(component.code)
			)
				continue;
			if (component.outpatient_sick_pay == null)
				refuse(
					`Outpatient sick leave needs allowance ${component.code} classified as included or excluded.`
				);
			if (component.outpatient_sick_pay === 'EXCLUDE') {
				if (component.eligibility.trim() !== '')
					refuse(
						`Outpatient sick leave needs allowance ${component.code} eligibility priced first.`
					);
				if (
					component.bands.length > 0 &&
					(component.bands.length !== 1 ||
						component.bands[0]?.when !== '' ||
						component.bands[0]?.amount !== 'entry.amount' ||
						component.bands[0]?.limit != null)
				)
					refuse(`Outpatient sick leave needs the priced amount of allowance ${component.code}.`);
				excluded += listed.amount;
			}
		}
		if (excluded === 0) return 0;
		const workload = termsWorkload({
			terms: term,
			configuration,
			workDays: bundle.workDays,
			window: monthBounds(monthKey(charge.date))
		});
		const divisor =
			charge.hours == null
				? termsDaysPerWeek(term, configuration)
				: (term.ordinary_hours_per_week ?? workload.average_weekly_paid_minutes / 60);
		if (!(divisor > 0)) refuse('Outpatient sick leave needs normal contractual days or hours.');
		return (12 * excluded) / (52 * divisor);
	};

	const workedOn = new Set(
		bundle.workDays
			.filter((day) => (day.worked_intervals?.length ?? 0) > 0)
			.map((day) => requiredDateKey(day.work_date, 'work_days.work_date'))
	);
	const workingDayOn = (date: string) => {
		const day = prorationScheduleIn(monthBounds(monthKey(date))).get(date);
		return day?.shift != null && (day.dayType === 'ORDINARY' || day.dayType === 'PUBLIC_HOLIDAY');
	};
	/**
	 * The unworked public holidays on a working day whose working day immediately before or after
	 * is `date` (SG EA s.88(3)); a substituted day is a holiday row like any other.
	 */
	const adjacentHolidays = (date: string): string[] =>
		[-1, 1].flatMap((step) => {
			// ponytail: a month's walk; no roster rests longer than that between two working days.
			for (let offset = 1; offset <= 31; offset += 1) {
				const candidate = addDays(date, step * offset);
				if (!workingDayOn(candidate)) continue;
				if (!configuration.holidays.has(candidate)) return [];
				if (!workedOn.has(candidate)) return [candidate];
				return [];
			}
			return [];
		});
	const holidayAdjacentAbsence =
		configuration.jurisdiction.payroll.holiday_adjacent_absence_unpaid === true;
	const absentDaysIn = (window: PayRange) => {
		const forfeited = new Set<string>();
		return bundle.workDays.flatMap((day) => {
			if (day.worked_intervals != null && day.worked_intervals.length > 0) return [];
			const date = requiredDateKey(day.work_date, 'work_days.work_date');
			if (date < window.start || date > window.end) return [];
			if (
				configuration.jurisdiction.work_rules.wages?.block_unmeasured_results_pay === true &&
				day.piece_units != null &&
				termsAt(bundle, date).base_salary <= 0 &&
				termsAt(bundle, date).statutory_work_category === 'PIECE_RATE'
			)
				return [];
			const uncovered = 1 - (coverage.days[date] ?? 0);
			if (uncovered <= 0) return [];
			const scheduled = schedule.get(date);
			if (scheduled?.shift == null || scheduled.dayType !== 'ORDINARY') return [];
			// An absence recorded as neither leave nor work had no prior consent (owner default,
			// register SG): the holiday beside it loses its pay, once, charged to the absent day.
			const holidays = holidayAdjacentAbsence
				? adjacentHolidays(date).filter((holiday) => !forfeited.has(holiday))
				: [];
			for (const holiday of holidays) forfeited.add(holiday);
			return [
				{ id: day.id, date, days: uncovered },
				...holidays.map((holiday) => ({ id: day.id, date: holiday, days: 1 }))
			];
		});
	};
	return {
		attendance,
		absentDaysIn,
		wageDays,
		closingTerms,
		rateTerms,
		currency,
		hourlyRate,
		dayWage,
		ratesOn,
		complianceWindow,
		schedule,
		/** The terms a schedule reads per day; the same reader outside the resolved window. */
		scheduleTermsAt,
		weeklySchedule,
		workDayByDate,
		dayRuleContext,
		coverage,
		workingDaysIn,
		isOrdinaryWorkingDay,
		absenceDayWage,
		subject,
		absenceRate,
		absenceCeiling,
		absenceHourlyRate,
		outpatientSickExcludedRate
	};
}

/**
 * Whether the person was present, or on leave with pay, on the workday immediately preceding a
 * holiday (PH Handbook ch.2 §D–E): a rest or non-work day before it looks further back (§D.3),
 * and so does an unworked holiday — two successive holidays are both paid to someone present
 * before the first, and the second to someone who worked the first (§E). Silence is presence,
 * as it is for the wage; a day read empty is present only under paid leave. A day before the
 * terms begin states no workday, so the test passes.
 */
function presentBeforeHoliday(
	bundle: Pick<EmploymentBundle, 'workDays' | 'termsHistory' | 'leave'>,
	configuration: Pick<Configuration, 'holidays' | 'patternById' | 'shiftById'>,
	holiday: IsoDate
): boolean {
	const rowOn = new Map(
		bundle.workDays.map((row) => [requiredDateKey(row.work_date, 'work_days.work_date'), row])
	);
	// ponytail: a month's lookback; no roster rests longer than that between two workdays.
	for (let back = 1; back <= 31; back += 1) {
		const date = addDays(holiday, -back);
		const row = rowOn.get(date);
		if ((row?.worked_intervals?.length ?? 0) > 0) return true;
		if (configuration.holidays.has(date)) continue;
		const terms = bundle.termsHistory.find((candidate) =>
			coversDate(candidate.effective_range, date)
		);
		if (terms == null) return true;
		const patternRow = termPatternRow(terms, configuration.patternById);
		const codeId =
			row?.shift_definition_id ??
			patternRosterCodeId(patternRow?.pattern ?? null, date, patternAnchor(patternRow));
		const code = codeId == null ? undefined : configuration.shiftById.get(codeId);
		if (code == null || rosterCodeKind(code.variant) !== 'WORK') continue;
		if (row?.worked_intervals == null) return true;
		const day = { start: date, end: date };
		return (
			(leaveCoverage(bundle.leave, day).days[date] ?? 0) > 0 &&
			unpaidLeaveDays(bundle.leave, day) === 0
		);
	}
	return true;
}

/** The contract's stated hours a day (`ordinary_hours_per_week` over its days), or null where it states none. */
function statedDayHours(
	terms: { readonly ordinary_hours_per_week?: unknown },
	days: number
): number | null {
	const hours = decodeNumber(terms.ordinary_hours_per_week ?? 0);
	return hours > 0 && days > 0 ? hours / days : null;
}

/** The contract's own day where it states one, else the statute's normal day; never the engine's. */
function contractDayHours(
	terms: { readonly ordinary_hours_per_week?: unknown },
	days: number,
	normalDayHours: number
): number {
	const hours = decodeNumber(terms.ordinary_hours_per_week ?? 0);
	if (hours > 0 && days > 0) return hours / days;
	if (Number.isFinite(normalDayHours)) return normalDayHours;
	throw new Error(
		'A contract with no roster states its ordinary hours a week, or its version states a normal day.'
	);
}

/** Price Work attendance using the money families' prepared period totals for wage coverage. */
export function calculateWorkAttendance(
	options: Pick<
		MeasureEmploymentOptions,
		'bundle' | 'configuration' | 'priorOvertimeHours' | 'priorInLieu'
	> & {
		readonly work: ReturnType<typeof prepareWorkContext>;
		readonly entryTotalByComponentId: ReadonlyMap<string, number>;
	}
) {
	const { bundle, configuration, entryTotalByComponentId } = options;
	const {
		attendance,
		wageDays,
		complianceWindow,
		schedule,
		scheduleTermsAt,
		weeklySchedule,
		workDayByDate,
		coverage,
		subject,
		rateTerms,
		closingTerms,
		absenceDayWage,
		dayWage,
		ratesOn
	} = options.work;
	// ── overtime: the day's planned entries, confirmed by attendance ─────────────────────────────
	//
	// `worked_intervals` is the presence test for the actual half of a work day: NULL means no
	// attendance was recorded at all, while an empty array means the day was read and nothing was
	// worked. A day carrying nothing but a plan was not confirmed, so `deriveDailyOvertime` pays its
	// `approved_overtime_hours` and `incentive_hours` only where the clock shows it was worked.
	const attendedDays = bundle.workDays.filter((day) => day.worked_intervals != null);
	// The weekly overtime-and-holiday ceilings payroll enforces, the consent each occasion needs and
	// the refusal of incentive hours (`limits[].enforced_at_payroll`, `overtime_consent`,
	// `incentive_hours_allowed`).
	const combinedLimits = applicableLimits(
		configuration.limits.filter(
			(limit) =>
				limit.enforced_at_payroll === true &&
				limit.period === 'WEEK' &&
				limit.measure === 'ALL_OVERTIME_HOURS'
		),
		subject
	);
	const consentRule = configuration.work.overtime_consent ?? null;
	const incentiveRefused = configuration.work.incentive_hours_allowed === false;
	if (combinedLimits.length > 0 || consentRule != null || incentiveRefused) {
		const weeklyHours = new Map<string, number>();
		for (const entry of bundle.workDays) {
			const date = requiredDateKey(entry.work_date, 'work_days.work_date');
			const day = weeklySchedule.get(date) ?? schedule.get(date);
			if (day == null) continue;
			if (incentiveRefused && decodeNumber(entry.incentive_hours ?? 0) > 0)
				refuse(
					`${bundle.employment.employee_number} has incentive hours on ${date}; work above a statutory ceiling must be refused.`
				);
			if (entry.worked_intervals == null || entry.worked_intervals.length === 0) continue;
			const clocked = {
				...entry,
				break_minutes: providedBreakMinutes({
					intervals: entry.worked_intervals,
					shiftMinutes: day.shift?.break_minutes ?? 0,
					breaks: configuration.breaks,
					person: subject,
					nightHours: nightHoursFor(
						entry,
						day,
						configuration.nightPremium,
						offsetMinutesFor(configuration.jurisdiction.payroll.timezone, date)
					)
				})
			};
			const worked = dailyWorkedHours(
				clocked,
				day,
				offsetMinutesFor(configuration.jurisdiction.payroll.timezone, date)
			);
			const premium = day.dayType === 'ORDINARY' ? Math.max(0, worked - day.normalHours) : worked;
			if (premium <= 1e-9) continue;
			// LPA s.65(1) and its equivalents: where the version's own overtime rule excludes this
			// person, the hours past the normal day are ordinary work, not unapproved overtime, so
			// there is nothing to plan.
			if (!isEligible(configuration.work.overtime_when, subject)) continue;
			if (consentRule != null) {
				// An occasion is consented as planned: worked beyond the approved hours is unconsented.
				const planned = decodeNumber(entry.approved_overtime_hours ?? 0);
				if (planned + 1e-9 < premium)
					refuse(
						`${bundle.employment.employee_number} worked ${premium.toFixed(2)} overtime or holiday hours on ${date}, but only ${planned.toFixed(2)} are approved for pay.`
					);
				const firstStart = Math.min(
					...entry.worked_intervals.map((interval) => Date.parse(interval.start))
				);
				const context = options.work.dayRuleContext(date, day);
				if (
					context != null &&
					dayFact(entry, consentRule.exception_fact) == null &&
					evaluateBoolean(expressionEngine, consentRule.required_when, context) &&
					(entry.overtime_consented_at == null ||
						!(Date.parse(entry.overtime_consented_at) < firstStart))
				)
					refuse(
						`${bundle.employment.employee_number} needs the worker’s prior consent for overtime or holiday work on ${date}.`
					);
			}
			const week = weekStart(date);
			weeklyHours.set(week, (weeklyHours.get(week) ?? 0) + premium);
		}
		for (const ceiling of combinedLimits)
			for (const [week, worked] of weeklyHours)
				if (worked > ceiling.max_hours + 1e-9)
					refuse(
						`${bundle.employment.employee_number} worked ${worked.toFixed(2)} overtime and holiday hours in the week of ${week}, above the ${ceiling.max_hours}-hour limit "${ceiling.key}".`
					);
	}
	// Overtime settles in the window the hours fall in: this employment's own attendance window.
	const overtimeAttendance = attendance;
	const overtimeDays: DailyOvertime[] = [];
	/** Clocked dates with overtime or night-window hours: a meal allowance's de minimis days (PH RR 11-2018 (j)). */
	const overtimeOrNightDates = new Set<IsoDate>();
	const bandDays: WorkBandDay[] = [];
	/** Observed company holidays the clock shows worked, in this run's overtime window. */
	const holidaysWorked: IsoDate[] = [];
	const clockedDays = attendedDays
		.map((entry) => ({ entry, workDate: requiredDateKey(entry.work_date, 'work_days.work_date') }))
		.filter(
			({ workDate }) => workDate >= complianceWindow.start && workDate <= complianceWindow.end
		)
		.toSorted((left, right) => (left.workDate < right.workDate ? -1 : 1));
	// The limits that govern this person: a conditional one (`limits[].when`) applies only where
	// its predicate holds over them.
	const limits = applicableLimits(configuration.limits, subject);
	// A weekly or daily normal-hours limit prices nothing here: hours beyond it pay only as the
	// day's planned entries (owner's rule, 2026-09-23). Clock time never pays.
	for (const { entry, workDate } of clockedDays) {
		const day = schedule.get(workDate);
		if (!day) continue;
		// Attendance is priced as it happened: the break rule belongs to the schedule gate
		// (`work_rules.breaks`), not to the money.
		// The break a normal day provides comes from the work pattern; where the statute owes a longer
		// mandatory rest break that minimum governs, and a gap the day already shows is not taken twice.
		const clocked = {
			...entry,
			break_minutes: providedBreakMinutes({
				intervals: entry.worked_intervals,
				shiftMinutes: day.shift?.break_minutes ?? 0,
				breaks: configuration.breaks,
				person: subject,
				nightHours: nightHoursFor(
					entry,
					day,
					configuration.nightPremium,
					offsetMinutesFor(configuration.jurisdiction.payroll.timezone, workDate)
				)
			})
		};
		const offset = offsetMinutesFor(configuration.jurisdiction.payroll.timezone, workDate);
		const daily = deriveDailyOvertime(
			clocked,
			day,
			configuration.breaks,
			offset,
			configuration.nightPremium,
			subject
		);
		const worked = daily?.totalWorkHours ?? dailyWorkedHours(clocked, day, offset);
		// EA 1955 s.60A(3)(a): overtime is work "in excess of the normal hours", not the clock-out
		// past the rostered window. A person rostered 09:00–18:00 who works 11:00–20:00 has worked
		// their eight normal hours, so the ordinary half is the normal day bounded by what they
		// actually worked. This is the same quantity the enforced weekly overtime guard above measures.
		const ordinary =
			day.dayType === 'ORDINARY' && day.shift != null ? Math.min(day.normalHours, worked) : 0;
		// A time entry is a clock reading: a departure past the shift is reported by
		// `validateUnplannedOvertime` as a warning, not refused here. Refusing the whole run over a
		// plan/clock delta hid every other settlement, and `work_days` keys planned hours in
		// half-hour steps a stray minute could never be expressed in.
		if (
			worked > 0 &&
			(day.dayType === 'PUBLIC_HOLIDAY' || day.dayType === 'SPECIAL_HOLIDAY') &&
			workDate >= overtimeAttendance.start &&
			workDate <= overtimeAttendance.end
		)
			holidaysWorked.push(workDate);
		// An unworked holiday the person's calendar recorded (a day read and found empty) is a
		// band day of zero hours: the first band that holds prices it by amount — a regular
		// holiday's day wage (PH art.94), a holiday on a non-working day (SG s.88).
		const unworkedHoliday =
			daily == null &&
			worked <= 0 &&
			(day.dayType === 'PUBLIC_HOLIDAY' || day.dayType === 'SPECIAL_HOLIDAY');
		const derived: DailyOvertime | null =
			daily == null
				? unworkedHoliday
					? {
							date: workDate,
							workDayId: entry.id,
							dayType: day.dayType,
							hours: 0,
							incentiveHours: 0,
							normalHours: day.normalHours,
							totalWorkHours: worked,
							breakMinutes: clocked.break_minutes,
							restBreak: null
						}
					: null
				: daily;
		const nightHours =
			configuration.nightPremium == null
				? 0
				: (() => {
						const night = nightWindowHours(
							clocked,
							configuration.nightPremium,
							day.dayType === 'ORDINARY' ? day.shift : null,
							offset
						);
						return night.ordinary + night.overtime;
					})();
		if ((derived?.hours ?? 0) > 0 || nightHours > 0) overtimeOrNightDates.add(workDate);
		if (!derived) continue;
		// A zero-hour holiday day is a band day, never an overtime day. Hours an emergency forced are
		// outside every hours ceiling (TW 勞基法 §32(2) caps only the §32(1) extension, §32(4) stands
		// apart), so they reach neither the ceiling counters nor the daily limit reports.
		if (derived.hours > 0 && entry.emergency_cause !== true) overtimeDays.push(derived);
		bandDays.push({
			workDayId: derived.workDayId,
			date: derived.date,
			dayType: derived.dayType,
			comparableFullTimeDailyHours:
				entry.comparable_full_time_daily_hours == null
					? undefined
					: decodeNumber(entry.comparable_full_time_daily_hours),
			// The planned day, never the clock: the normal day plus the planned hours on an ordinary
			// or off day, the planned hours alone on a rest day or holiday.
			workedHours:
				day.dayType === 'ORDINARY' || day.dayType === 'OFF_DAY'
					? derived.normalHours + derived.hours
					: derived.hours,
			normalHours: derived.normalHours,
			overtimeHours: derived.hours,
			incentiveHours: derived.incentiveHours,
			breakMinutes: clocked.break_minutes,
			holidayKind: configuration.holidays.get(workDate)?.kind ?? '',
			holidayName: configuration.holidays.get(workDate)?.name ?? '',
			holidayPriorPresent:
				!configuration.holidays.has(workDate) ||
				presentBeforeHoliday(bundle, configuration, workDate),
			consecutiveHours: derived.restBreak?.longestRunHours ?? 0,
			continuousAttendance: false,
			restDay: day.restDay,
			statutoryRest: day.statutoryRest,
			offDay: day.offDay,
			nightHours,
			requestedBy: entry.requested_by ?? 'EMPLOYER',
			emergency: entry.emergency_cause === true,
			timeOffInLieu: entry.time_off_in_lieu === true,
			facts: scalarFacts(entry.facts),
			factKeys: (entry as { readonly fact_keys?: readonly string[] }).fact_keys
		});
	}
	// The wage the ceiling is measured against is derived per Employment Act 1955 s.2 as narrowed by
	// First Schedule para 3 — basic plus every other cash payment for work done, less overtime pay —
	// from the employee's own components and entries. Only components this employment is eligible
	// for count: an allowance someone is not entitled to is not part of their wages.
	const paymentEligibleOn = (date: IsoDate) => {
		const dated = ratesOn(date).person;
		const allowances = new Map(
			listedAllowances(termsAt(bundle, date)).map((row) => [
				configuration.allowanceCodeById.get(row.catalogue_id),
				row.amount
			])
		);
		const statutoryWages = deriveStatutoryWages({
			baseSalary: { ...rateTerms.base_salary, value: dated.terms.basic_salary },
			payments: configuration.catalogueComponents
				.filter((component) => isEligible(component.eligibility, subject))
				.map((component) => ({
					category: classifyWageComparand(component),
					amount:
						component.family === 'ALLOWANCE'
							? (allowances.get(component.code) ?? 0)
							: (entryTotalByComponentId.get(component.id) ?? 0)
				}))
		});
		// Who the overtime ladder covers is the version's own predicate over the person, read with the
		// statutory wage comparand this run derived.
		return isEligible(configuration.work.overtime_when, {
			...dated,
			terms: { ...dated.terms, statutory_wages: statutoryWages.value }
		});
	};
	if (configuration.work.earlier_rest_day_work === 'REFUSE') {
		const lastEmployed = employmentDates(bundle.employment).exit;
		for (const day of bandDays) {
			if (
				day.date < overtimeAttendance.start ||
				day.date > overtimeAttendance.end ||
				day.dayType !== 'REST_DAY' ||
				day.workedHours <= 0 ||
				day.emergency ||
				!paymentEligibleOn(day.date)
			)
				continue;
			for (
				let later = addDays(day.date, 1);
				later <= addDays(weekStart(day.date), 6);
				later = addDays(later, 1)
			) {
				if (lastEmployed != null && later > lastEmployed) break;
				const next =
					schedule.get(later) ??
					resolveSchedule({
						window: { start: later, end: later },
						dates: [later],
						terms: scheduleTermsAt,
						workDays: bundle.workDays,
						rosters: bundle.rosters,
						configuration
					}).get(later);
				if (next?.restDay)
					refuse(
						`${bundle.employment.employee_number}: ${day.date} is an earlier contractual rest day; its work needs the statutory 104-hour overtime count while preserving the company's rest-day rate.`
					);
			}
		}
	}
	const pricedBandDays = bandDays.filter(
		(day) =>
			day.date >= overtimeAttendance.start &&
			day.date <= overtimeAttendance.end &&
			paymentEligibleOn(day.date)
	);
	// The regulated-overtime ceiling governs the overtime the Act pays. A salaried engineer outside
	// the overtime rule has no regulated hours to cap, so the ceiling is not reported against them.
	// Counted over the days `counts` admits: the whole calendar months for this run's report, the
	// attendance window for what this payslip settles and a later run's quarter or year reads.
	const countOvertime = (counts: (date: IsoDate) => boolean) => {
		const regulatedByMonth = new Map<string, number>();
		// The wider count an ALL_OVERTIME_HOURS limit reads: rest-day and holiday hours beyond the
		// normal day too (MOM on SG's 72-hour month). Reported only.
		const allByMonth = new Map<string, number>();
		// Every planned hour, incentive included: storing the excess as incentive pays it, and does
		// not undo the breach the ceiling reports (MY reg.4 limits the hours required).
		for (const day of overtimeDays) {
			if (!counts(day.date) || !paymentEligibleOn(day.date)) continue;
			const calendarMonth = monthKey(day.date);
			const regulated = day.dayType === 'ORDINARY' || day.dayType === 'OFF_DAY';
			const beyondNormal = regulated ? day.hours : Math.max(0, day.hours - day.normalHours);
			allByMonth.set(calendarMonth, (allByMonth.get(calendarMonth) ?? 0) + beyondNormal);
			if (!regulated) continue;
			regulatedByMonth.set(calendarMonth, (regulatedByMonth.get(calendarMonth) ?? 0) + day.hours);
		}
		// Every month, quarter and year ceiling's own count. One whose `counts_day_when` holds on a
		// day counts every hour worked on it in place of what its measure counted there (TW 勞基法
		// §36(3): 休息日 hours enter the §32(2) totals); one whose `counts_beyond_normal_when` holds
		// counts the hours past the normal day (TW: past eight on a 例假 or §37 休假日). Emergency
		// days stay outside, as above.
		const byLimit = new Map<string, Map<string, number>>();
		for (const limit of limits) {
			if (
				(limit.measure !== 'OVERTIME_HOURS' && limit.measure !== 'ALL_OVERTIME_HOURS') ||
				limit.period === 'DAY' ||
				limit.period === 'WEEK'
			)
				continue;
			const all = limit.measure === 'ALL_OVERTIME_HOURS';
			const byMonth = new Map(all ? allByMonth : regulatedByMonth);
			const whole = (limit.counts_day_when ?? '').trim();
			const beyond = (limit.counts_beyond_normal_when ?? '').trim();
			if (whole !== '' || beyond !== '')
				for (const day of bandDays) {
					if (day.emergency === true || !counts(day.date) || !paymentEligibleOn(day.date)) continue;
					const rates = ratesOn(day.date);
					const holds = (expression: string) =>
						expression !== '' &&
						workDayHolds({
							work: configuration.work,
							expression,
							person: rates.person,
							day,
							rates
						});
					const everyHour = holds(whole);
					if (!everyHour && !holds(beyond)) continue;
					const regulated = day.dayType === 'ORDINARY' || day.dayType === 'OFF_DAY';
					const beyondNormal = regulated
						? day.overtimeHours
						: Math.max(0, day.overtimeHours - day.normalHours);
					const counted = regulated || all ? beyondNormal : 0;
					const month = monthKey(day.date);
					const added = (everyHour ? day.workedHours : beyondNormal) - counted;
					byMonth.set(month, (byMonth.get(month) ?? 0) + added);
				}
			byLimit.set(limit.key, byMonth);
		}
		return { regulatedByMonth, allByMonth, byLimit };
	};
	const {
		regulatedByMonth: calendarMonthOvertimeHours,
		allByMonth: calendarMonthAllOvertimeHours,
		byLimit: calendarMonthLimitHours
	} = countOvertime(() => true);
	const settled = countOvertime(
		(date) => date >= overtimeAttendance.start && date <= overtimeAttendance.end
	);
	// What this payslip settled, as each ceiling counts it; `''` is the regulated count. Persisted
	// on the run's trace for the next run's quarter and year.
	const settledOvertimeHours = new Map([['', settled.regulatedByMonth], ...settled.byLimit]);

	// Absent days — a rostered day with no time entry: no row is presence (the pattern stands), a row
	// with intervals is the truth, a row with no time entry (`null` or `[]` alike, inside the window)
	// is absence and one day comes off the salary, and approved leave deducts through its own rule. REST,
	// OFF, holidays and days outside the window are no-ops; DAILY and HOURLY pay earned units instead.
	const absentDays = options.work.absentDaysIn(attendance);
	const absentAdjustments: MeasuredAdjustment[] =
		absentDays.length === 0 ||
		rateTerms.pay_frequency === 'DAILY' ||
		rateTerms.pay_frequency === 'HOURLY'
			? []
			: measureAbsence({
					employeeNumber: bundle.employment.employee_number,
					companyName: configuration.company.name,
					catalogueComponents: configuration.catalogueComponents,
					subject,
					dayWage: absenceDayWage,
					days: absentDays,
					currency: options.work.currency
				});

	// ── the night premium: the regime's window, priced per day on this run's attendance ────────
	const nightPremium = configuration.nightPremium ?? null;
	const nightDays =
		nightPremium == null
			? []
			: attendedDays.flatMap((entry) => {
					const date = requiredDateKey(entry.work_date, 'work_days.work_date');
					if (date < overtimeAttendance.start || date > overtimeAttendance.end) return [];
					const day = schedule.get(date);
					const priced = day;
					const bandDay = pricedBandDays.find((row) => row.workDayId === entry.id);
					const shift = priced != null && priced.dayType === 'ORDINARY' ? priced.shift : null;
					const offset = offsetMinutesFor(configuration.jurisdiction.payroll.timezone, date);
					const clocked = {
						...entry,
						break_minutes: providedBreakMinutes({
							intervals: entry.worked_intervals,
							shiftMinutes: priced?.shift?.break_minutes ?? 0,
							breaks: configuration.breaks,
							person: subject,
							nightHours: nightHoursFor(entry, priced, nightPremium, offset)
						})
					};
					// Overtime is the day's planned hours beyond its normal ones. A scheduled day nobody
					// planned overtime on has none; a day with no shift is overtime past its normal hours,
					// all of it when unscheduled.
					const night = nightWindowHours(
						clocked,
						nightPremium,
						shift,
						offset,
						bandDay != null
							? bandDay.workedHours - bandDay.normalHours
							: shift != null
								? 0
								: priced == null
									? Number.POSITIVE_INFINITY
									: Math.max(0, dailyWorkedHours(clocked, priced, offset) - priced.normalHours)
					);
					// Overtime hours add nothing where the person is outside statutory overtime pay.
					const overtime = paymentEligibleOn(date) ? night.overtime : 0;
					if (night.ordinary + overtime <= 0) return [];
					// The adds follow the day where the version says so. A day the bands never saw — no
					// overtime (an ordinary night shift), outside the overtime window, or an ineligible
					// person — is read as the scheduled day it is, with no overtime; only an unscheduled
					// day falls back to the plain figures.
					const addDay =
						bandDay ??
						(priced == null
							? null
							: {
									workDayId: entry.id,
									date,
									dayType: priced.dayType,
									workedHours: priced.normalHours,
									normalHours: priced.normalHours,
									overtimeHours: 0,
									breakMinutes: 0,
									holidayKind: configuration.holidays.get(date)?.kind ?? '',
									holidayName: configuration.holidays.get(date)?.name ?? '',
									consecutiveHours: 0,
									continuousAttendance: false,
									restDay: priced.restDay,
									statutoryRest: priced.statutoryRest,
									offDay: priced.offDay,
									nightHours: night.ordinary + night.overtime,
									requestedBy: entry.requested_by ?? 'EMPLOYER'
								});
					const adds =
						addDay == null
							? {
									ordinary: Predicate.isNumber(nightPremium.ordinary_add)
										? nightPremium.ordinary_add
										: 0,
									overtime: Predicate.isNumber(nightPremium.overtime_add)
										? nightPremium.overtime_add
										: 0
								}
							: nightAddsFor({
									work: { ...configuration.work, limits },
									premium: nightPremium,
									person: ratesOn(date).person,
									day: addDay,
									rates: ratesOn(date)
								});
					return [
						{
							id: entry.id,
							ordinary: night.ordinary,
							overtime,
							adds,
							rate: ratesOn(date).ordinaryHour
						}
					];
				});
	const nightShiftHours = nightDays.reduce((total, day) => total + day.ordinary + day.overtime, 0);
	const bandRows = measureWorkBands({
		work: { ...configuration.work, limits },
		personOn: (date) => ratesOn(date).person,
		days: pricedBandDays,
		ratesOn,
		catalogueComponents: configuration.catalogueComponents,
		currency: options.work.currency
	});
	// The normal-day bands (`bands[].component`): additional normal-time wages, read on every
	// ordinary rostered day of the wage window over the hours the day actually held — its
	// punches, or the presumed shift where it records none.
	const normalBandDays: WorkBandDay[] = [];
	if (configuration.work.bands.some((band) => band.component != null))
		for (const [date, day] of schedule) {
			if (
				date < wageDays.start ||
				date > wageDays.end ||
				day.dayType !== 'ORDINARY' ||
				day.shift == null
			)
				continue;
			const workedDay = workDayByDate.get(date);
			const intervals = workedDay?.worked_intervals;
			const offset = offsetMinutesFor(configuration.jurisdiction.payroll.timezone, date);
			const worked =
				workedDay == null || intervals == null
					? day.normalHours
					: intervals.length === 0
						? 0
						: dailyWorkedHours(
								{
									...workedDay,
									break_minutes: providedBreakMinutes({
										intervals,
										shiftMinutes: day.shift.break_minutes,
										breaks: configuration.breaks,
										person: subject,
										nightHours: nightHoursFor(workedDay, day, configuration.nightPremium, offset)
									})
								},
								day,
								offset
							);
			const bandDay: WorkBandDay = {
				workDayId: workedDay?.id ?? '',
				date,
				dayType: 'ORDINARY',
				workedHours: worked,
				normalHours: day.normalHours,
				overtimeHours: 0,
				breakMinutes: day.shift.break_minutes,
				holidayKind: '',
				holidayName: '',
				consecutiveHours: 0,
				continuousAttendance: false,
				restDay: day.restDay,
				offDay: day.offDay,
				nightHours: 0,
				requestedBy: workedDay?.requested_by ?? 'EMPLOYER',
				facts: scalarFacts(workedDay?.facts),
				factKeys: (workedDay as { readonly fact_keys?: readonly string[] } | undefined)?.fact_keys
			};
			const priced = priceWorkDay({
				work: { ...configuration.work, limits },
				person: ratesOn(date).person,
				day: bandDay,
				rates: ratesOn(date),
				normalDay: true
			});
			if (priced.length === 0) continue;
			// Priced only as attended work: a day with no record to carry the line, or leave that
			// stands in for the hours, has no stated price here.
			if (workedDay == null)
				refuse(
					`${bundle.employment.employee_number} needs a recorded work day for ${priced[0]!.label} on ${date}.`
				);
			if (
				activeTimeOff(bundle.leave.entries).some((entry) =>
					entry.charges.some((charge) => charge.date === date)
				)
			)
				refuse(
					`${bundle.employment.employee_number} needs leave-hour pricing for ${priced[0]!.label} on ${date}.`
				);
			normalBandDays.push(bandDay);
		}
	// Time off elected in lieu of overtime pay: bands honouring the election stand aside and leave
	// those hours unpriced. Each band slice they left is credited at what it would have paid, in
	// the order the hours were worked, and the run keeps the balance (TW 勞基法 §32-1).
	const credits = pricedBandDays.flatMap((day): InLieuSlice[] => {
		if (day.timeOffInLieu !== true) return [];
		const price = (priced: WorkBandDay) =>
			priceWorkDay({
				work: { ...configuration.work, limits },
				person: ratesOn(day.date).person,
				day: priced,
				rates: ratesOn(day.date)
			});
		const stood = new Map(price(day).map((row) => [row.ruleKey, row.hours]));
		return price({ ...day, timeOffInLieu: false }).flatMap((row) => {
			const hours = row.hours - (stood.get(row.ruleKey) ?? 0);
			return hours > 0
				? [
						{
							work_day_id: row.workDayId,
							date: day.date,
							line: row.line,
							label: row.label,
							hours,
							rate: row.rate,
							amount: row.rate * hours,
							paid: false
						}
					]
				: [];
		});
	});
	const inLieuRules = configuration.work.time_off_in_lieu ?? null;
	const inLieu =
		inLieuRules == null
			? { slices: [], adjustments: [], overdrawn: 0 }
			: settleTimeOffInLieu({
					rules: inLieuRules,
					credits,
					prior: options.priorInLieu ?? [],
					bundle,
					person: subject,
					catalogueComponents: configuration.catalogueComponents,
					shiftById: configuration.shiftById,
					currency: options.work.currency
				});
	const inLieuDays = [...Map.groupBy(credits, (slice) => slice.date)].map(([date, slices]) => ({
		date,
		hours: slices.reduce((sum, slice) => sum + slice.hours, 0),
		amount: cents(
			slices.reduce((sum, slice) => sum + slice.amount, 0),
			options.work.currency
		)
	}));
	// A company holiday worked by a person the overtime rule does not cover pays no overtime: HR
	// grants an off-in-lieu day for it. Stated, never created.
	const holidaysWithoutOvertime = holidaysWorked.filter((date) => !paymentEligibleOn(date));
	const inLieuNotes: RunIssue[] = [
		...holidaysWithoutOvertime.map((date) => ({
			code: 'HOLIDAY_WORKED_NO_OVERTIME',
			severity: 'WARNING' as const,
			message:
				`${[bundle.employment.employee_number, bundle.employee.name].filter(Boolean).join(' ')} ` +
				`worked the company holiday ${date} but is not entitled to overtime pay — grant an ` +
				'off-in-lieu (OIL) leave day.',
			collection: 'employments',
			recordId: bundle.employment.id
		})),
		...(inLieuDays.length === 0
			? []
			: [
					{
						code: 'TIME_OFF_IN_LIEU_OWED',
						severity: 'WARNING' as const,
						message:
							`${bundle.employment.employee_number} elected time off instead of overtime pay for ` +
							`${inLieuDays.reduce((sum, day) => sum + day.hours, 0)} hours ` +
							`(${inLieuDays.map((day) => `${day.date}: ${day.hours} h, ${day.amount}`).join('; ')} ` +
							`${options.work.currency} at the day's rates). This run pays none of it. The hours are ` +
							(inLieuRules == null
								? 'owed as time off; any not taken by the agreed expiry or the end of the contract are ' +
									'owed as wages at these amounts — pay them as an ad hoc payment then. No time-off ' +
									'balance is kept for them.'
								: `owed as time off, taken as ${inLieuRules.leave_code} leave oldest first; payroll ` +
									'pays any hour not taken by its expiry or the end of the contract at these amounts.'),
						collection: 'employments',
						recordId: bundle.employment.id
					}
				]),
		...(inLieu.overdrawn <= 0
			? []
			: [
					{
						code: 'TIME_OFF_IN_LIEU_OVERDRAWN',
						severity: 'WARNING' as const,
						message:
							`${bundle.employment.employee_number} took ${inLieu.overdrawn} hours of ` +
							`${inLieuRules?.leave_code} leave in this period with no unexpired elected overtime ` +
							'hours left to take them from. Record them under another leave type.',
						collection: 'employments',
						recordId: bundle.employment.id
					}
				])
	];
	const adjustments = [
		...bandRows,
		...measureWorkBands({
			work: { ...configuration.work, limits },
			personOn: (date) => ratesOn(date).person,
			days: normalBandDays,
			ratesOn,
			catalogueComponents: configuration.catalogueComponents,
			currency: options.work.currency,
			normalDay: true
		}),
		...(nightPremium == null
			? []
			: measureNightPremium({
					premium: nightPremium,
					days: nightDays,
					catalogueComponents: configuration.catalogueComponents,
					subject,
					currency: options.work.currency
				})),
		...absentAdjustments
	];
	const lockSpan = {
		start: wageDays.start < attendance.start ? wageDays.start : attendance.start,
		end: wageDays.end > attendance.end ? wageDays.end : attendance.end
	};
	const capturedWorkDayIds = [
		...new Set([
			...adjustments.map((row) => row.input.id),
			...attendedDays.flatMap((day) => {
				const date = requiredDateKey(day.work_date, 'work_days.work_date');
				return date >= lockSpan.start && date <= lockSpan.end ? [day.id] : [];
			}),
			...(configuration.jurisdiction.work_rules.wages?.block_unmeasured_results_pay === true
				? bundle.workDays.flatMap((day) => {
						const date = requiredDateKey(day.work_date, 'work_days.work_date');
						return day.piece_units != null &&
							date >= wageDays.start &&
							date <= wageDays.end &&
							termsAt(bundle, date).base_salary <= 0 &&
							termsAt(bundle, date).statutory_work_category === 'PIECE_RATE'
							? [day.id]
							: [];
					})
				: [])
		])
	];
	return {
		// An in-lieu payout names the elected day it pays, which an earlier payslip already pinned:
		// it rides with the money, never with this payslip's captures.
		adjustments: [...adjustments, ...inLieu.adjustments],
		capturedWorkDayIds,
		overtimeDays,
		overtimeOrNightDates,
		calendarMonthOvertimeHours,
		calendarMonthAllOvertimeHours,
		calendarMonthLimitHours,
		settledOvertimeHours,
		nightShiftHours,
		/** The rostered days with no punch and no leave, for an allowance that loses unpaid days. */
		absentDays,
		/** Overtime elected as time off in lieu, with what the day's bands would have paid. */
		inLieuNotes,
		/** This payslip's in-lieu credits and payouts, for the trace a later run reads. */
		inLieuSlices: inLieu.slices,
		/** The limits that govern this person, the conditional ones judged. */
		limits
	};
}

/**
 * A contracted monthly figure priced over the period's calendar, one segment per terms row.
 *
 * The wage and every allowance on the contract are the same arithmetic: the terms row in force
 * on each day states the figure, consecutive days under one row are one segment, and each
 * segment is prorated against the same full-period divisor on the person's basis. A mid-period
 * change is two segments. Both are written down — the terms row that covered them, the days, the
 * divisor those days were taken over, the basis that counted them, the contract amount and the
 * prorated result — and the base entry is their sum, so a payslip can be re-read years after a
 * jurisdiction changed how it prorates. `unpaidDaysIn` is the allowances' own rule: where the
 * jurisdiction prorates an allowance on unpaid leave (`payroll.allowance_npl_prorates`) those
 * days come off each segment; the wage never takes it, its absence being a line of its own.
 */
export function measureContractSegments(options: {
	readonly component: CatalogueComponent;
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly salary: PayRange;
	readonly employed: PayRange;
	readonly contracted: PayRange;
	readonly workingDaysIn: (window: PayRange) => number;
	/** The full-period figure the terms row states; 0 where the row states none. */
	readonly contractOf: (terms: EmploymentBundle['terms'][number]) => number;
	/** Standing allowances are monthly even when the basic salary is weekly. */
	readonly contractPeriod?: 'MONTH' | undefined;
	readonly unpaidDaysIn?: ((window: PayRange) => number) | undefined;
}): Measurement | null {
	const bucket = settlementBucket(options.component.destination, options.component.direction);
	const currency = options.configuration.jurisdiction.payroll.currency;
	const termsOn = (date: IsoDate): EmploymentBundle['terms'][number] =>
		date > options.contracted.end
			? termsAt(options.bundle, options.contracted.end)
			: termsAt(options.bundle, date);
	const measured: {
		readonly segment: NonNullable<ReturnType<typeof prorationSegment>>;
		readonly unpaid: number;
		readonly termKey: string;
		readonly contract: number;
		readonly exact: number;
	}[] = [];
	const record = (
		terms: EmploymentBundle['terms'][number],
		covered: { readonly start: IsoDate; readonly end: IsoDate } | null
	): void => {
		const contract = options.contractOf(terms);
		// A terms row that states no figure for this line covers no segment of it: the line is
		// what the contract lists, and a row that lists nothing is not a zero-amount segment.
		if (contract === 0) return;
		// The basis is the person's: read over the terms row this segment prices, with the week
		// that row's pattern works. `terms.ordinary_hours_per_week` is the roster's, never the
		// row's own column, and without it a `proration_by` arm keyed on the week (PH: the
		// six-day roster's 313 factor) never held — every six-day joiner prorated on 21.75.
		const workload = termsWorkload({
			terms,
			configuration: options.configuration,
			workDays: options.bundle.workDays,
			window: options.salary
		});
		const segment = prorationSegment({
			work: options.configuration.work,
			person: personContext({
				employee: options.bundle.employee,
				employment: stint(
					options.bundle.employment,
					options.configuration.jurisdiction.exit_facts ?? []
				),
				fixedAllowances: contractAllowancesOn(
					options.bundle,
					options.configuration,
					options.salary.end
				),
				terms,
				week: {
					ordinary_hours_per_week:
						workload.work_days > 0
							? workload.average_weekly_paid_minutes / 60
							: (terms.ordinary_hours_per_week ?? 0),
					working_days_per_week: termsDaysPerWeek(terms, options.configuration)
				},
				children: options.bundle.children,
				company: options.configuration.company,
				asOf: options.salary.end
			}),
			period:
				options.contractPeriod === 'MONTH' && covered != null
					? (intersectDays(options.salary, monthBounds(monthKey(covered.start))) ?? options.salary)
					: options.salary,
			covered,
			employed: options.employed,
			workingDaysIn: options.workingDaysIn,
			instalments: terms.pay_frequency === 'SEMI_MONTHLY' ? 2 : 1,
			salaryPeriod: options.contractPeriod ?? (terms.pay_frequency === 'WEEKLY' ? 'WEEK' : 'MONTH')
		});
		if (segment == null || segment.denominator <= 0 || segment.days <= 0) return;
		const unpaid =
			options.unpaidDaysIn == null
				? 0
				: options.unpaidDaysIn({ start: segment.from, end: segment.to });
		const days = Math.max(0, segment.days - unpaid);
		measured.push({
			segment: { ...segment, days },
			unpaid,
			termKey: termsSnapshotKey(terms),
			contract,
			exact: contract * (days / segment.denominator)
		});
	};
	/**
	 * One terms row per calendar day, then collapse consecutive days. Independently clipping
	 * every overlapping terms row to the month produced two identical full-month segments and
	 * double BASIC whenever two history rows both covered the window.
	 */
	const wageDates = daysBetween(options.employed.start, options.employed.end);
	if (wageDates.length > 0) {
		let runStart = wageDates[0]!;
		let runTerms = termsOn(runStart);
		for (let index = 1; index <= wageDates.length; index += 1) {
			const date = wageDates[index];
			const nextTerms = date == null ? null : termsOn(date);
			if (
				nextTerms != null &&
				termsIdentity(nextTerms) === termsIdentity(runTerms) &&
				(options.contractPeriod !== 'MONTH' || monthKey(date!) === monthKey(runStart))
			)
				continue;
			record(runTerms, { start: runStart, end: wageDates[index - 1]! });
			if (date == null || nextTerms == null) break;
			runStart = date;
			runTerms = nextTerms;
		}
	}
	if (measured.length === 0) return null;
	/**
	 * The month is rounded once, and the segments are made to add up to it.
	 *
	 * Rounding each segment on its own and summing the results is a different number: 4,000 x
	 * 15/31 and 4,600 x 16/31 round to 1,935.48 and 2,374.19, which total 4,309.67, while the
	 * month itself is 4,309.68. The month's figure is the one that reconciles against the source
	 * system, so it is the one that is paid — and the residue lands on the final segment rather
	 * than being left as a cent nobody can account for. `payslip_proration` says the segments
	 * sum; this is what makes that true rather than nearly true.
	 */
	const amount = cents(
		measured.reduce((total, entry) => total + entry.exact, 0),
		currency
	);
	let allocated = 0;
	const segments: PayslipProration[] = measured.map((entry, index) => {
		const prorated =
			index === measured.length - 1
				? cents(amount - allocated, currency)
				: cents(entry.exact, currency);
		allocated = cents(allocated + prorated, currency);
		return {
			component_code: options.component.code,
			term_key: entry.termKey,
			from: entry.segment.from,
			to: entry.segment.to,
			basis: entry.segment.basis,
			days: entry.segment.days,
			denominator: entry.segment.denominator,
			unpaid_days: entry.unpaid,
			contract_amount: entry.contract,
			prorated_amount: prorated
		};
	});
	return {
		amount,
		base: [baseLine(options.component, bucket, amount)],
		// A period one terms row covers whole is still one segment, and it is still recorded:
		// "31 of 31 days at the contract" is a statement, and a payslip that only carries it
		// sometimes is a payslip whose reader has to know when.
		proration: segments,
		adjustments: []
	};
}

function measureWorkComponent(
	options: Pick<
		MeasureComponentOptions,
		| 'component'
		| 'bundle'
		| 'configuration'
		| 'salary'
		| 'employed'
		| 'contracted'
		| 'period'
		| 'workingDaysIn'
		| 'rates'
		| 'subject'
		| 'note'
	>
): Measurement | null {
	const definition = options.component.definition;
	const bucket = settlementBucket(options.component.destination, options.component.direction);
	const currency = options.configuration.jurisdiction.payroll.currency;

	/**
	 * The terms covering one calendar day, clamped to the contracted span: days past the contract
	 * end read the closing row rather than throwing in `termsAt`. Shared by the proration walk and
	 * the earned-units measurement, which read the same day through the same row.
	 */
	const termsOn = (date: IsoDate): EmploymentBundle['terms'][number] =>
		date > options.contracted.end
			? termsAt(options.bundle, options.contracted.end)
			: termsAt(options.bundle, date);
	// Earned pay for DAILY and HOURLY: expected units × the stated rate — days for DAILY,
	// paid minutes for HOURLY, summed over `expected(E, d)`. A part-time teacher with no
	// roster rows and no punches earns zero; with three rostered days and no punches, three
	// days. MONTHLY, SEMI_MONTHLY and WEEKLY never land here: salary prorated over the
	// employment span, less unpaid days, exactly as before.
	const closingFrequency = payFrequency(termsOn(options.employed.end).pay_frequency);
	const resultsPay = options.configuration.jurisdiction.work_rules.wages?.results_pay;
	const calendarLeave = new Set(
		resultsPay?.piece_calendar_leave_refused === true
			? activeTimeOff(options.bundle.leave.entries).flatMap((entry) =>
					entry.charges
						.filter((charge) =>
							options.bundle.leave.catalogues.some(
								(row) => row.id === charge.catalogue_id && row.entitlement.calendar_days === true
							)
						)
						.map((charge) => charge.date)
				)
			: []
	);

	/**
	 * A `SCHEDULE` component is the contracted wage: the terms walk below, with the row's base
	 * salary as the figure — or, for a DAILY or HOURLY contract, the units earned.
	 */
	const resultsOnly =
		options.configuration.jurisdiction.work_rules.wages?.block_unmeasured_results_pay === true &&
		termsOn(options.employed.end).statutory_work_category === 'PIECE_RATE' &&
		termsOn(options.employed.end).base_salary <= 0;
	const unitPiece =
		resultsPay?.measure_piece_from_units === true &&
		termsOn(options.employed.end).statutory_work_category === 'PIECE_RATE';
	const taskOnly =
		resultsPay?.task_only_time_events_refused === true &&
		termsOn(options.employed.end).statutory_work_category === 'TASK_BASIS' &&
		termsOn(options.employed.end).base_salary <= 0;
	if (
		taskOnly &&
		(activeTimeOff(options.bundle.leave.entries).some((entry) =>
			entry.charges.some(
				(charge) => charge.date >= options.employed.start && charge.date <= options.employed.end
			)
		) ||
			daysBetween(options.employed.start, options.employed.end).some(
				(date) =>
					options.configuration.holidays.has(date) ||
					options.bundle.workDays.some(
						(day) =>
							dateKey(day.work_date) === date &&
							((day.worked_intervals?.length ?? 0) > 0 ||
								decodeNumber(day.approved_overtime_hours ?? 0) > 0 ||
								decodeNumber(day.incentive_hours ?? 0) > 0)
					)
			))
	)
		refuse(
			`${options.bundle.employment.employee_number}: task, trip or commission pay with leave, holiday, clocked work or overtime needs a statutory wage-rate calculation before this month can be settled.`
		);
	const measureSchedule = (): Measurement | null =>
		unitPiece || resultsOnly
			? measurePieceEarned()
			: closingFrequency === 'DAILY' || closingFrequency === 'HOURLY'
				? measureEarned()
				: measureContractSegments({
						component: options.component,
						bundle: options.bundle,
						configuration: options.configuration,
						salary: options.salary,
						employed: options.employed,
						contracted: options.contracted,
						workingDaysIn: options.workingDaysIn,
						contractOf: (terms) => terms.base_salary
					});

	/** Results wages are earned on each recorded workday, at that day's units and unit rate. */
	const measurePieceEarned = (): Measurement => {
		if (
			resultsOnly &&
			activeTimeOff(options.bundle.leave.entries).some((entry) =>
				entry.charges.some(
					(charge) => charge.date >= options.employed.start && charge.date <= options.employed.end
				)
			)
		)
			refuse(
				`${options.bundle.employment.employee_number}: piece-paid leave needs an evidenced wage valuation before this month can be settled.`
			);
		if (
			[...calendarLeave].some(
				(date) => date >= options.employed.start && date <= options.employed.end
			)
		)
			refuse(
				`${options.bundle.employment.employee_number} has calendar-day leave while paid by piece; the preceding wage-period average this leave payment needs is not available.`
			);
		let earned = 0;
		for (const date of daysBetween(options.employed.start, options.employed.end)) {
			const terms = termsOn(date);
			if (
				terms.statutory_work_category !== termsOn(options.employed.end).statutory_work_category ||
				(resultsOnly && terms.base_salary > 0)
			)
				refuse(
					`${options.bundle.employment.employee_number} changes results-pay category or basic wages inside ${options.period}.`
				);
			const day = options.bundle.workDays.find((row) => dateKey(row.work_date) === date);
			if (
				resultsOnly &&
				(options.configuration.holidays.has(date) ||
					day?.worked_intervals != null ||
					decodeNumber(day?.approved_overtime_hours ?? 0) > 0 ||
					decodeNumber(day?.incentive_hours ?? 0) > 0)
			)
				refuse(
					`${options.bundle.employment.employee_number}: piece-paid holiday, clocked work or overtime on ${date} needs a statutory wage-rate calculation before this month can be settled.`
				);
			const pattern = termPatternRow(terms, options.configuration.patternById);
			const codeId =
				day?.shift_definition_id ??
				patternRosterCodeId(pattern?.pattern ?? null, date, patternAnchor(pattern));
			const scheduledWork =
				codeId != null &&
				rosterCodeKind(options.configuration.shiftById.get(codeId)?.variant) === 'WORK';
			if (resultsOnly && day?.piece_units != null && !scheduledWork)
				refuse(
					`${options.bundle.employment.employee_number}: piece work on ${date} is outside an ordinary scheduled day; its rest-day rate is not available.`
				);
			if (resultsOnly ? day?.piece_units == null : !scheduledWork && day?.piece_units == null)
				continue;
			if (day?.piece_units == null || day.piece_unit_rate == null)
				refuse(
					`${options.bundle.employment.employee_number} needs piece units and unit rate on ${date}.`
				);
			earned += decodeNumber(day.piece_units) * decodeNumber(day.piece_unit_rate);
		}
		const amount = cents(earned, currency);
		return {
			amount,
			base: [baseLine(options.component, bucket, amount)],
			proration: [],
			adjustments: []
		};
	};

	const measureResultsFloor = (): Measurement | null => {
		if (!resultsOnly && !taskOnly) return null;
		const month = monthBounds(options.period.slice(0, 7));
		if (
			options.salary.start !== month.start ||
			options.salary.end !== month.end ||
			options.bundle.window?.attendance.start !== month.start ||
			options.bundle.window.attendance.end !== month.end ||
			options.bundle.employedDays?.start !== month.start ||
			options.bundle.employedDays.end !== month.end ||
			options.bundle.arrearsFor != null
		)
			refuse(
				`${options.bundle.employment.employee_number}: results pay needs a full calendar month on the same attendance and salary window, with no earlier-month arrears.`
			);
		const firstVersion = settingsInForce(
			options.configuration.lineageVersions,
			options.configuration.jurisdiction.code,
			month.start
		);
		const lastVersion = settingsInForce(
			options.configuration.lineageVersions,
			options.configuration.jurisdiction.code,
			month.end
		);
		if (
			options.configuration.lineageVersions.length > 0 &&
			(firstVersion == null || lastVersion == null || firstVersion.id !== lastVersion.id)
		)
			refuse('A results-pay minimum wage changes inside this calendar month.');
		if (!minimumWageCovers(options.configuration, options.subject)) return null;
		const floor = cents(
			bindingMinimumWage(options.configuration, options.subject, month.end),
			currency
		);
		if (floor <= 0) return null;
		let earned: number;
		if (taskOnly) {
			if (options.subject.terms.fixed_allowances !== 0)
				refuse(
					`${options.bundle.employment.employee_number}: fixed allowances on task, trip or commission terms need a sourced minimum-wage classification before the monthly comparator can run.`
				);
			if (
				daysBetween(month.start, month.end).some((date) => {
					const terms = termsOn(date);
					return (
						terms.statutory_work_category !== 'TASK_BASIS' ||
						terms.base_salary > 0 ||
						terms.pay_frequency !== 'MONTHLY'
					);
				}) ||
				options.bundle.workDays.some(
					(day) =>
						dateKey(day.work_date) >= month.start &&
						dateKey(day.work_date) <= month.end &&
						day.piece_units != null
				)
			)
				refuse(
					`${options.bundle.employment.employee_number}: task, trip and commission results need monthly terms and typed wage requests; piece-unit workday amounts do not identify their statutory earning class.`
				);
			const codes = [
				'TASK_MONTHLY_WAGE',
				'TRIP_MONTHLY_WAGE',
				'COMMISSION_MONTHLY',
				'COMMISSION_IRREGULAR'
			];
			const attestations = options.bundle.payRequests.filter(
				(request) =>
					request.family === 'ADHOC' &&
					request.catalogueComponent.code === 'RESULTS_ZERO_MONTH' &&
					(request.pay_period === monthKey(month.start) ||
						(request.event_date >= month.start && request.event_date <= month.end))
			);
			if (attestations.length > 0) {
				const attestation = attestations[0]!;
				if (
					attestations.length !== 1 ||
					options.bundle.payRequests.some(
						(request) =>
							request.family === 'ADHOC' &&
							codes.includes(request.catalogueComponent.code) &&
							(request.pay_period === monthKey(month.start) ||
								(request.event_date >= month.start && request.event_date <= month.end))
					) ||
					attestation.event_date !== month.end ||
					attestation.pay_period !== monthKey(month.start) ||
					decodeNumber(attestation.amount) !== 0 ||
					attestation.sign !== 1 ||
					attestation.evidence_file == null ||
					attestation.approval_id != null ||
					attestation.captured
				)
					refuse(
						`${options.bundle.employment.employee_number}: one evidenced zero-results attestation dated ${month.end}, paid in ${monthKey(month.start)}, must stand alone before the monthly minimum can be assessed.`
					);
				earned = 0;
			} else {
				const requests = options.bundle.payRequests.filter(
					(request) =>
						request.family === 'ADHOC' &&
						codes.includes(request.catalogueComponent.code) &&
						request.pay_period === monthKey(month.start) &&
						request.approval_id == null &&
						!request.captured
				);
				if (requests.length === 0)
					refuse(
						`${options.bundle.employment.employee_number}: task, trip and commission wages cannot be verified against the monthly minimum wage of ${describeVersion(options.configuration.jurisdiction)} until their payable amounts and contribution treatment are recorded as distinct earnings.`
					);
				for (const request of requests)
					if (
						request.event_date < month.start ||
						request.event_date > month.end ||
						request.sign !== 1 ||
						request.evidence_file == null
					)
						refuse(
							`${options.bundle.employment.employee_number}: ${request.catalogueComponent.code} needs positive evidenced wages earned and paid in ${monthKey(month.start)} before the monthly minimum can be assessed.`
						);
				earned = cents(
					requests.reduce((total, request) => total + decodeNumber(request.amount), 0),
					currency
				);
			}
		} else {
			if (
				!options.bundle.workDays.some(
					(day) =>
						dateKey(day.work_date) >= month.start &&
						dateKey(day.work_date) <= month.end &&
						day.piece_units != null
				)
			)
				refuse(
					`${options.bundle.employment.employee_number}: record actual piece units, including zero, before assessing this results-pay month.`
				);
			earned = measurePieceEarned().amount;
		}
		const amount = cents(Math.max(0, floor - earned), currency);
		if (amount === 0) return null;
		options.note({
			code: 'MINIMUM_WAGE_TOP_UP',
			severity: 'WARNING',
			message: `${options.bundle.employment.employee_number}: ${earned} in ${taskOnly ? 'task, trip or commission' : 'piece'} earnings plus ${amount} minimum-wage top-up meets the ${floor} monthly floor.`,
			collection: 'employment_terms',
			recordId: termsOn(options.employed.end).id
		});
		return {
			amount,
			base: [baseLine(options.component, bucket, amount)],
			proration: [],
			adjustments: []
		};
	};

	/**
	 * Earned base pay for one DAILY- or HOURLY-paid month.
	 *
	 * `expected(E, d)` is the roster override, else the work-pattern projection — the same
	 * precedence the schedule resolves, read here for the shift half only. A day with no row
	 * earns its expected day; an absent mark (`[]`) on an expected WORK day earns nothing, and
	 * no separate absence deduction is raised for these frequencies. A day whose terms state
	 * another frequency refuses loudly: silently mixing a monthly proration into earned units
	 * would underpay it.
	 */
	const measureEarned = (): Measurement => {
		const dates = daysBetween(options.employed.start, options.employed.end);
		const leave = leaveCoverage(options.bundle.leave, options.employed).days;
		const planByDate = new Map<IsoDate, string>();
		const actualByDate = new Map<IsoDate, EmploymentBundle['workDays'][number]>();
		for (const day of options.bundle.workDays) {
			const date = requiredDateKey(day.work_date, 'work_days.work_date');
			if (day.shift_definition_id != null) planByDate.set(date, day.shift_definition_id);
			actualByDate.set(date, day);
		}
		let exact = 0;
		for (const date of dates) {
			const dayTerms = termsOn(date);
			const frequency = payFrequency(dayTerms.pay_frequency);
			if (frequency !== 'DAILY' && frequency !== 'HOURLY') {
				throw new Error(
					`${options.bundle.employment.employee_number} changes pay frequency within ` +
						`${options.period}: ${date} is on ${frequency} terms inside a ${closingFrequency} ` +
						`month. Make the frequency change effective at a period boundary.`
				);
			}
			const actual = actualByDate.get(date);
			const intervals = actual?.worked_intervals;
			const patternRow = termPatternRow(dayTerms, options.configuration.patternById);
			const codeId =
				planByDate.get(date) ??
				patternRosterCodeId(patternRow?.pattern ?? null, date, patternAnchor(patternRow));
			const code = codeId == null ? null : options.configuration.shiftById.get(codeId);
			if (codeId != null && code == null)
				throw new Error(`Schedule on ${date} names roster code ${codeId}, which does not exist.`);
			if (code != null && !coversDate(code.effective_range, date))
				throw new Error(`Roster code ${code.code} is not effective on ${date}.`);
			if (code == null || rosterCodeKind(code.variant) !== 'WORK') {
				if (calendarLeave.has(date)) {
					const workload = termsWorkload({
						terms: dayTerms,
						configuration: options.configuration,
						workDays: options.bundle.workDays,
						window: monthBounds(monthKey(date))
					});
					const days = termsDaysPerWeek(dayTerms, options.configuration);
					// The statute's normal day on that day's terms (`work_rules.normal_hours`).
					const normalHoursRule = (options.configuration.work.normal_hours ?? '').trim();
					const rateTerms = asRateTerms(
						dayTerms,
						workload,
						days,
						normalHoursRule === ''
							? Number.POSITIVE_INFINITY
							: evaluatePersonNumber(
									normalHoursRule,
									personContext({
										employee: options.bundle.employee,
										employment: stint(
											options.bundle.employment,
											options.configuration.jurisdiction.exit_facts ?? []
										),
										terms: dayTerms,
										week: {
											ordinary_hours_per_week:
												workload.work_days > 0
													? workload.average_weekly_paid_minutes / 60
													: (dayTerms.ordinary_hours_per_week ?? 0),
											working_days_per_week: days
										},
										children: options.bundle.children,
										company: options.configuration.company,
										asOf: date
									})
								)
					);
					exact += ordinaryDayWage(rateTerms, 1);
				}
				continue;
			}
			const shift = { ...workWindow(code.variant)!, id: code.id, code: code.code };
			const scheduledHours = shift.paid_minutes / 60;
			// Leave covers its reserved share of ordinary hours, including an explicitly empty punch.
			// Work includes those units; unpaid Leave deducts its own share once at the actual rate.
			// A regular holiday not worked is still a paid day for the daily-paid (PH art.94: 100% of
			// the daily wage); an empty punch on it records nothing to deduct.
			const holidayKind = options.configuration.holidays.get(date)?.kind;
			const unworked = intervals == null || intervals.length === 0;
			if (
				holidayKind === 'SPECIAL_HOLIDAY' &&
				unworked &&
				options.configuration.jurisdiction.payroll.special_holiday_unworked_unpaid === true
			)
				continue;
			const regularHoliday = holidayKind === 'PUBLIC_HOLIDAY' || holidayKind === 'DOUBLE_HOLIDAY';
			// PH Handbook ch.2 §D: an unworked regular holiday is paid only to someone present, or on
			// paid leave, on the workday before it, where the version says so.
			if (
				regularHoliday &&
				unworked &&
				options.configuration.jurisdiction.payroll.regular_holiday_prior_workday === true &&
				!presentBeforeHoliday(options.bundle, options.configuration, date)
			)
				continue;
			const holidayUnit = regularHoliday && unworked;
			const hours =
				actual != null && intervals != null && !holidayUnit
					? Math.min(
							scheduledHours,
							ordinaryWorkedHours(
								{
									...actual,
									break_minutes: providedBreakMinutes({
										intervals,
										shiftMinutes: shift.break_minutes,
										breaks: options.configuration.breaks,
										person: options.subject,
										nightHours: nightHoursFor(
											{ ...actual, work_date: date },
											{ shift },
											options.configuration.nightPremium,
											offsetMinutesFor(options.configuration.jurisdiction.payroll.timezone, date)
										)
									})
								},
								shift,
								offsetMinutesFor(options.configuration.jurisdiction.payroll.timezone, date)
							) +
								(leave[date] ?? 0) * scheduledHours
						)
					: scheduledHours;
			const rate = dayTerms.base_salary;
			exact += frequency === 'DAILY' ? rate * (hours / scheduledHours) : hours * rate;
		}
		const amount = cents(exact, currency);
		return {
			amount,
			base: [baseLine(options.component, bucket, amount)],
			proration: [],
			adjustments: []
		};
	};

	switch (definition.source) {
		case 'SCHEDULE':
			return measureSchedule();
		case 'RESULTS_FLOOR':
			return measureResultsFloor();
		case 'ENTRY':
			throw new Error('Work cannot measure a money-entry component.');
		// Priced by the rules from work days (`measureOvertime`), never by the catalogue walk: the
		// row exists so the opt-ins of derived overtime live where every other opt-in does.
		case 'ABSENCE':
		case 'DERIVED_OVERTIME':
		case 'DERIVED_NORMAL':
			return null;
		default: {
			const _exhaustive: never = definition;
			throw new Error(`Unsupported component source: ${JSON.stringify(_exhaustive)}`);
		}
	}
}

/**
 * One unpaid day per absent day, carried by the company's absence component.
 *
 * An amount is a magnitude — direction is the component's own nature — and each row names the
 * work day it came from, so the payslip line and the settlement lock agree on what was priced.
 */
function measureAbsence(options: {
	readonly employeeNumber: string;
	readonly companyName: string;
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly subject: PersonContext;
	readonly dayWage: number;
	readonly days: readonly { readonly id: string; readonly date: string; readonly days: number }[];
	readonly currency: string;
}): MeasuredAdjustment[] {
	if (options.days.length === 0) return [];
	const dates = options.days
		.map((day) => day.date)
		.toSorted()
		.join(', ');

	const absenceLines = options.catalogueComponents.filter(
		(candidate) => candidate.family === 'WORK' && candidate.output === 'absence'
	);
	if (absenceLines.length === 0)
		throw new Error(
			`${options.employeeNumber} was marked absent on ${dates}, but ${options.companyName} has ` +
				'no Work absence output.'
		);
	const component = absenceLines[0]!;
	if (!isEligible(component.eligibility, options.subject)) {
		throw new Error(
			`${options.employeeNumber} was marked absent, but the absence component ${component.code} ` +
				`does not cover this employment. Broaden its eligibility or point the company at one that does.`
		);
	}
	// Round the running total, not each day (as Leave does): 22 days of cents(3,000 ÷ 22) are
	// 0.08 short of the month, and s.20A(1)(c) leaves a wholly absent month at exactly nil.
	let priced = 0;
	return options.days
		.toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
		.map((day) => {
			const previous = priced;
			priced += options.dayWage * day.days;
			return {
				input: { family: 'WORK_DAY' as const, id: day.id },
				catalogueComponent: component,
				bucket: settlementBucket(component.destination, component.direction),
				label: component.code,
				amount: cents(
					cents(priced, options.currency) - cents(previous, options.currency),
					options.currency
				),
				quantity: day.days,
				rate: cents(options.dayWage),
				statutoryRuleKey: null
			};
		});
}

/**
 * The night premium: minutes inside the regime's window add a percentage of the hourly rate,
 * one percentage on ordinary hours and another on overtime hours. One line per work day under the
 * Work `night` output, so the settlement lock is the day that earned it.
 */
function measureNightPremium(options: {
	readonly premium: NonNullable<Configuration['nightPremium']>;
	readonly days: readonly {
		readonly id: string;
		readonly ordinary: number;
		readonly overtime: number;
		readonly adds: { readonly ordinary: number; readonly overtime: number };
		/** The ordinary hour of the calendar month the day fell in. */
		readonly rate: number;
	}[];
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly subject: PersonContext;
	readonly currency: string;
}): MeasuredAdjustment[] {
	if (options.days.length === 0) return [];
	const component = options.catalogueComponents.find(
		(row) => row.family === 'WORK' && row.output === 'night'
	);
	if (component == null) throw new Error('Work catalogue is missing its night premium output.');
	if (!isEligible(component.eligibility, options.subject)) return [];
	const wage = options.catalogueComponents.find(
		(row) => row.family === 'WORK' && row.output === 'night_wage'
	);
	return options.days.flatMap((day) => {
		const amount = cents(
			day.rate * ((day.ordinary * day.adds.ordinary + day.overtime * day.adds.overtime) / 100),
			options.currency
		);
		const ordinaryWage = cents(day.rate * day.ordinary, options.currency);
		return [
			...(amount === 0
				? []
				: [
						{
							input: { family: 'WORK_DAY' as const, id: day.id },
							catalogueComponent: component,
							bucket: settlementBucket(component.destination, component.direction),
							label: component.code,
							amount,
							quantity: day.ordinary + day.overtime,
							rate: day.rate,
							statutoryRuleKey: null
						}
					]),
			// The ordinary night hours' share of the salary, shown beside the premium (VN Decree
			// 253/2026 art.26(1): the employer's statement of night hours and night wage paid).
			...(wage == null || ordinaryWage === 0
				? []
				: [
						{
							input: { family: 'WORK_DAY' as const, id: day.id },
							catalogueComponent: wage,
							bucket: settlementBucket(wage.destination, wage.direction),
							label: wage.code,
							amount: ordinaryWage,
							quantity: day.ordinary,
							rate: day.rate,
							statutoryRuleKey: null
						}
					])
		];
	});
}

/**
 * Work bands, priced from the clocks and the version's own rules.
 *
 * Each day's facts go to `priceWorkDay`; every row it returns is one payslip line, one row per
 * (work day × band × class), settled under the component whose output is `line:label`, with the
 * work day as its provenance. The day's planned incentive hours settle on the band's INCENTIVE
 * line at the band's own award.
 */
function measureWorkBands(options: {
	readonly work: Configuration['work'];
	readonly personOn: (date: IsoDate) => PersonContext;
	readonly days: readonly WorkBandDay[];
	readonly ratesOn: (date: IsoDate) => { readonly ordinaryHour: number; readonly dayWage: number };
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly currency: string;
	/** Price the normal-day bands, whose line is the component they post to. */
	readonly normalDay?: boolean | undefined;
}): MeasuredAdjustment[] {
	const byOutput = new Map(
		options.catalogueComponents
			.filter((row) => row.family === 'WORK')
			.map((row) => [row.output ?? '', row])
	);
	const rows: MeasuredAdjustment[] = [];
	for (const day of options.days) {
		for (const row of priceWorkDay({
			work: options.work,
			person: options.personOn(day.date),
			day,
			rates: options.ratesOn(day.date),
			normalDay: options.normalDay
		})) {
			const component = byOutput.get(
				options.normalDay === true ? row.line : `${row.line}:${row.label}`
			);
			if (component == null)
				throw new Error(
					`Work rules produced ${row.line} ${row.label} with no pay item to settle it.`
				);
			rows.push({
				input: { family: 'WORK_DAY', id: row.workDayId },
				catalogueComponent: component,
				bucket: settlementBucket(component.destination, component.direction),
				label: row.label,
				amount: cents(row.amount, options.currency),
				quantity: row.hours,
				rate: row.rate,
				statutoryRuleKey: row.ruleKey
			});
		}
	}
	return rows;
}

/**
 * The balance of overtime taken as time off (TW 勞基法 §32-1; 施行細則 §22-2), kept by payroll
 * from what the payslips recorded and the leave HR approved — no leave row is ever written.
 *
 * Every credited slice, this run's and the earlier payslips', is consumed by the hours taken as
 * `leave_code` leave, oldest slice first (§22-2(1): 依…事實發生時間先後順序補休), a slice only
 * while unexpired on the day taken. A slice expires `expiry_months` after its day, and never later
 * than the last day of the `year_leave_code` leave's year (§22-2(1)). What a slice has left once
 * it has expired by the end of this salary window, or when the contract ends inside it, is paid at
 * the credited value (§32-1(2)), less what an earlier payslip already paid of it.
 */
function settleTimeOffInLieu(options: {
	readonly rules: NonNullable<Configuration['work']['time_off_in_lieu']>;
	readonly credits: readonly InLieuSlice[];
	readonly prior: readonly InLieuSlice[];
	readonly bundle: EmploymentBundle;
	readonly person: PersonContext;
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly shiftById: Configuration['shiftById'];
	readonly currency: string;
}): { slices: InLieuSlice[]; adjustments: MeasuredAdjustment[]; overdrawn: number } {
	const { rules, bundle } = options;
	if (options.credits.length === 0 && options.prior.length === 0)
		return { slices: [], adjustments: [], overdrawn: 0 };
	const through = bundle.window.salary.end;
	const { hire, exit } = employmentDates(bundle.employment);
	const leaving = exit != null && exit <= through;
	const asOf = leaving ? exit : through;
	const year = bundle.leave.catalogues.find((row) => row.code === rules.year_leave_code);
	if (year == null)
		refuse(
			`Time off in lieu expires with the ${rules.year_leave_code} leave year, and this version has no such leave.`
		);
	const months = evaluatePersonNumber(rules.expiry_months, options.person);
	const expiryOf = (date: IsoDate) => {
		const yearEnd = leaveWindowOf(date, year.entitlement, hire).end;
		if (months <= 0) return yearEnd;
		const agreed = addDays(
			monthDay(
				Number.parseInt(date.slice(0, 4), 10),
				Number.parseInt(date.slice(5, 7), 10) - 1 + months,
				Number.parseInt(date.slice(8, 10), 10)
			),
			-1
		);
		return agreed < yearEnd ? agreed : yearEnd;
	};
	const key = (slice: InLieuSlice) => `${slice.work_day_id}:${slice.line}:${slice.label}`;
	const paidBefore = new Map<string, number>();
	for (const slice of options.prior)
		if (slice.paid) paidBefore.set(key(slice), (paidBefore.get(key(slice)) ?? 0) + slice.hours);
	const credits = [...options.prior.filter((slice) => !slice.paid), ...options.credits].toSorted(
		(left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0)
	);
	const remaining = credits.map((slice) => slice.hours);
	const reversed = new Set(
		bundle.leave.entries.flatMap((entry) =>
			entry.as_adjustment_entry === true && entry.reversal_of_id != null
				? [entry.reversal_of_id]
				: []
		)
	);
	// §32-1 is hour for hour: an entry taken by the hour is its own hours (one day at a time), and
	// a day or half day is its share of that day's roster code's paid hours — never eight hours a
	// day, which over-consumed the balance on any shorter normal day.
	const hoursOf = (entry: (typeof bundle.leave.entries)[number]) =>
		entry.charges.map((charge) => {
			if (entry.hours != null) return { date: charge.date, hours: entry.hours };
			const shift =
				charge.shift_definition_id == null
					? null
					: options.shiftById.get(charge.shift_definition_id);
			const window = shift == null ? null : workWindow(shift.variant);
			if (window == null)
				refuse(
					`${rules.leave_code} leave on ${charge.date} names no working roster code, so the hours it takes from the time-off balance are unknown.`
				);
			return { date: charge.date, hours: (charge.days * window.paid_minutes) / 60 };
		});
	const taken = bundle.leave.entries
		.filter(
			(entry) =>
				entry.leave_code === rules.leave_code &&
				entry.as_adjustment_entry !== true &&
				!reversed.has(entry.id)
		)
		.flatMap(hoursOf)
		.filter((charge) => charge.date <= asOf)
		.toSorted((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
	let overdrawn = 0;
	for (const leave of taken) {
		let hours = leave.hours;
		credits.forEach((slice, index) => {
			if (hours <= 0 || slice.date > leave.date || expiryOf(slice.date) < leave.date) return;
			const used = Math.min(hours, remaining[index]!);
			remaining[index] = remaining[index]! - used;
			hours -= used;
		});
		if (leave.date >= bundle.attendance.start) overdrawn += hours;
	}
	const byOutput = new Map(
		options.catalogueComponents
			.filter((row) => row.family === 'WORK')
			.map((row) => [row.output ?? '', row])
	);
	const payouts = credits.flatMap((slice, index): InLieuSlice[] => {
		if (!leaving && expiryOf(slice.date) > through) return [];
		const hours = remaining[index]! - (paidBefore.get(key(slice)) ?? 0);
		return hours > 1e-9
			? [{ ...slice, hours, amount: cents(slice.rate * hours, options.currency), paid: true }]
			: [];
	});
	return {
		slices: [...options.credits, ...payouts],
		adjustments: payouts.map((slice): MeasuredAdjustment => {
			const component = byOutput.get(`${slice.line}:${slice.label}`);
			if (component == null)
				throw new Error(
					`Work rules produced ${slice.line} ${slice.label} with no pay item to settle it.`
				);
			return {
				input: { family: 'WORK_DAY', id: slice.work_day_id },
				catalogueComponent: component,
				bucket: settlementBucket(component.destination, component.direction),
				label: slice.label,
				amount: slice.amount,
				quantity: slice.hours,
				rate: slice.rate,
				statutoryRuleKey: `${slice.line}:${slice.label}`
			};
		}),
		overdrawn
	};
}

export function prepareWorkSteps(
	options: Omit<MeasureComponentOptions, 'component' | 'entry'>
): readonly import('./family.js').FamilyStep[] {
	return options.configuration.catalogueComponents
		.filter((item) => item.family === 'WORK')
		.map((component) => ({
			item: component,
			calculate: () =>
				isEligible(component.eligibility, options.subject)
					? measureWorkComponent({ ...options, component })
					: null
		}));
}

/** Work returns all input issues together; the payroll coordinator decides whether to proceed. */
export function validateWorkInputs(options: {
	readonly configuration: Configuration;
	readonly bundles: GatheredRun['bundles'];
	readonly period: string;
	readonly window: PayrollWindow;
}): RunIssue[] {
	const { configuration, bundles, period, window } = options;
	const issues: RunIssue[] = [];
	// An open clock is caught here rather than three phases in, where `normalizedWorkedIntervals`
	// refuses it as an "invalid interval" — true, but a long way from the record at fault. Reported
	// as issues rather than thrown one at a time, so a month with thirty-six unclosed days yields
	// one list instead of thirty-six consecutive builds.
	issues.push(...validateOpenWorkDays({ bundles }));
	// Rostered employments carry no pattern day: their guaranteed or capped load is measured here,
	// over the pay window, with the same sentences precheck reports. A MONTHLY rostered employment
	// with zero expected days stops here rather than deriving ordinary hours from nothing.
	issues.push(
		...validateRosteredExpectations({
			period,
			window: window.attendance,
			employments: bundles
				.filter((bundle) => bundle.employedDays != null)
				.map((bundle) => ({
					id: bundle.employment.id,
					employee_number: bundle.employment.employee_number,
					window: bundle.window.attendance,
					terms: bundle.terms.map((term) => ({
						id: term.id,
						pay_frequency: term.pay_frequency,
						work_pattern: termPattern(term, configuration.patternById),
						effective_range: term.effective_range
					})),
					workDays: bundle.workDays.map((day) => ({
						work_date: day.work_date,
						shift_definition_id: day.shift_definition_id
					})),
					holidayDates: new Set(atWorksite(configuration, bundle.termsHistory).holidays.keys())
				})),
			...rosteredWorkCodeMaps(
				[...configuration.shiftById].map(([id, code]) => ({ id, variant: code.variant }))
			)
		})
	);
	return issues;
}

/**
 * Work reports statutory daily, monthly, quarterly and yearly limits from its measured attendance.
 * A quarter or a year is counted to date: what earlier payslips of this person settled for
 * the same months, plus this run.
 */
export function validateWorkResult(options: {
	readonly configuration: Configuration;
	readonly measured: MeasuredEmployment;
	/** Overtime earlier payslips settled: limit key (`''` regulated) → calendar month → hours. */
	readonly priorOvertimeHours?: ReadonlyMap<string, ReadonlyMap<string, number>> | undefined;
}): RunIssue[] {
	const { configuration, measured } = options;
	const { bundle } = measured;
	const issues: RunIssue[] = validateOvertimeLimits({
		configuration: { ...configuration, limits: measured.limits },
		employeeNumber: bundle.employment.employee_number,
		hoursByMonth: measured.calendarMonthOvertimeHours,
		allHoursByMonth: measured.calendarMonthAllOvertimeHours,
		limitHoursByMonth: measured.calendarMonthLimitHours,
		priorHoursByMonth: options.priorOvertimeHours ?? new Map()
	});
	// The daily ceiling is the jurisdiction's, read from its regime where `period = 'DAY'`.
	// It used to be a literal 12 here, which meant Malaysia's cap was applied to every country in
	// the workspace. A jurisdiction that states no daily limit now has none enforced, rather than
	// inheriting one from a statute that does not govern it.
	// Daily ceilings are reported from the named limits; the schedule gate is where they refuse.
	// The schedule is measured over whole calendar months, but a day is reported in the one run
	// whose attendance window pays it — otherwise the next run flags the same day again.
	const { attendance } = bundle;
	const ownDays = measured.overtimeDays.filter(
		(day) => day.date >= attendance.start && day.date <= attendance.end
	);
	const plannedByWorkDayId = new Map(
		bundle.workDays.map((row) => [
			String(row.id),
			decodeNumber(row.approved_overtime_hours ?? 0) + decodeNumber(row.incentive_hours ?? 0)
		])
	);
	issues.push(
		...validateUnplannedOvertime({
			employeeNumber: bundle.employment.employee_number,
			days: ownDays,
			plannedByWorkDayId
		})
	);
	for (const limit of measured.limits) {
		if (limit.period !== 'DAY') continue;
		// The limit's own citation only: the whole work_rules authority is a paragraph, not a cite.
		const authority = limit.authority ?? undefined;
		if (limit.measure === 'TOTAL_WORK_HOURS')
			issues.push(
				...validateDailyWorkLimit({
					employeeNumber: bundle.employment.employee_number,
					days: ownDays,
					maxWorkHours: limit.max_hours,
					authority,
					unit: limit.unit
				})
			);
		if (limit.measure === 'OVERTIME_HOURS')
			issues.push(
				...validateDailyOvertimeHoursLimit({
					employeeNumber: bundle.employment.employee_number,
					days: ownDays,
					maxOvertimeHours: limit.max_hours,
					authority
				})
			);
	}
	return issues;
}
