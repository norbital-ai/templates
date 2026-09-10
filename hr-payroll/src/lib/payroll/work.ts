/** Work owns schedules, contracted wages, attendance, and the rates supplied to Leave. */
import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { MoneyValue } from '@norbital-ai/std/finance';
import { decodeNumber } from '@norbital-ai/std/json';
import type {
	CatalogueComponent,
	Configuration,
	OvertimeCoverageRule
} from '../../collections/payroll_runs/lib/configuration.js';
import type { EmploymentBundle, GatheredRun } from '../../collections/payroll_runs/lib/gather.js';
import {
	PAGE_LIMIT,
	type PayrollReadApi,
	type ReadLog
} from '../../collections/payroll_runs/lib/api.js';
import { workPayItems } from '../../collections/work_catalogue/pay-items.js';
import type { ComponentDefinition } from '../../collections/payroll_runs/lib/configuration.js';
import type { PayslipProration } from '../../datatypes/payslip_proration/+definition.js';
import type { LeaveCharge } from '../../datatypes/leave_charges/+definition.js';
import {
	classifyWageComparand,
	decideOvertimeCoverage,
	deriveStatutoryWages,
	type WageBasis
} from '../../collections/payroll_runs/lib/coverage.js';
import {
	dateKey,
	daysBetween,
	inclusiveDays,
	monthBounds,
	monthKey,
	requiredDateKey,
	type IsoDate
} from '../../collections/payroll_runs/lib/dates.js';
import { coversDate, live, overlapsRange } from '../../collections/payroll_runs/lib/effective.js';
import {
	isEligible,
	personContext,
	type PersonContext
} from '../../collections/payroll_runs/lib/eligibility.js';
import { evaluateFormula } from '../../collections/payroll_runs/lib/formula.js';
import {
	classifyOvertimeByCalendarMonth,
	deriveDailyOvertime,
	ordinaryWorkedHours,
	nightWindowHours,
	overtimeBandCode,
	priceDay,
	type DailyOvertime,
	type ExcessHours,
	type OvertimeBandIdentity,
	type PricedSegment
} from '../../collections/payroll_runs/lib/overtime.js';
import {
	absenceDayRate,
	ordinaryDayWage,
	ordinaryHourlyRate,
	resolveOrdinaryRate,
	type RateTerms
} from '../../collections/payroll_runs/lib/ordinary-rate.js';
import { prorationSegment } from '../../collections/payroll_runs/lib/proration.js';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import { resolveSchedule } from '../../collections/payroll_runs/lib/schedule.js';
import type { ScheduledDay } from '../../collections/payroll_runs/lib/schedule.js';
import type { PayrollWindow } from '../../collections/payroll_runs/lib/period.js';
import {
	validateDailyOvertimeHoursLimit,
	validateAbsenceTreatments,
	validateDailyWorkLimit,
	validateOpenWorkDays,
	validateOvertimeLimits,
	validateRosteredExpectations,
	rosteredWorkCodeMaps,
	type RunIssue
} from '../../collections/payroll_runs/lib/validate.js';
import { leaveCoverage } from '../leave/payroll.js';
import { countryOf } from '../jurisdiction_settings.js';
import {
	patternRosterCodeId,
	patternWorkload,
	termPattern,
	type PatternWorkload
} from '../scheduling/work-pattern.js';
import { rosterCodeKind, workWindow } from '../scheduling/roster-code.js';
import type {
	Measurement,
	MeasureComponentOptions,
	MeasuredAdjustment,
	MeasuredEmployment,
	MeasureEmploymentOptions,
	PayRange
} from './family.js';
import { baseLine } from './family.js';

/** Work resolves its catalogue and the roster definitions used throughout the payroll window. */
export function prepareWorkCatalogue(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly jurisdiction: Configuration['jurisdiction'];
	readonly companyId: string;
	readonly windowStart: IsoDate;
	readonly windowEnd: IsoDate;
}): Effect.Effect<
	Pick<
		Configuration,
		| 'work'
		| 'holidayRestPrecedence'
		| 'overtimeRules'
		| 'overtimeLimits'
		| 'restBreakRules'
		| 'nightPremium'
		| 'overtimeCoverageRule'
		| 'shiftById'
		| 'patternById'
	> & { readonly payItems: Configuration['catalogueComponents'] }
> {
	return Effect.gen(function* () {
		const { jurisdiction, windowStart, windowEnd } = options;
		const db = options.api.db;
		const approved = { approval_id: { isNull: true } } as const;
		const [workRows, shiftRows, patternRows] = yield* Effect.all(
			[
				db.work_catalogue.findMany({
					where: { settings_id: { eq: jurisdiction.id }, ...approved },
					limit: PAGE_LIMIT
				}),
				db.shift_definitions.findMany({
					where: { company_id: { eq: options.companyId }, ...approved },
					limit: PAGE_LIMIT
				}),
				db.shift_patterns.findMany({
					where: { company_id: { eq: options.companyId }, ...approved },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(workRows, 'Work catalogue');
		const activeWork = live(workRows);
		if (activeWork.length !== 1)
			refuse(`Settings ${jurisdiction.code} require exactly one Work catalogue definition.`);
		const work: Configuration['work'] = {
			...activeWork[0]!,
			jurisdiction_code: jurisdiction.jurisdiction_code
		};
		options.api.reads.assertComplete(shiftRows, 'shift definitions');
		options.api.reads.assertComplete(patternRows, 'shift patterns');
		const shifts = live(shiftRows).filter((row) =>
			overlapsRange(row.effective_range, windowStart, windowEnd)
		);
		const regime = work.regime;
		if (regime == null)
			refuse(`Jurisdiction ${jurisdiction.code} has no statutory regime snapshot.`);
		return {
			work,
			payItems: workPayItems(work).map((row) => ({ ...row, settlement: 'PAYROLL' as const })),
			holidayRestPrecedence: regime.holiday_rest_precedence,
			overtimeRules: regime.overtime_rules,
			overtimeLimits: regime.overtime_limits,
			restBreakRules: regime.rest_break_rules ?? [],
			nightPremium: regime.night_premium ?? null,
			overtimeCoverageRule: regime.overtime_coverage,
			shiftById: new Map(shifts.map((row) => [row.id, row])),
			// A terms row still names its original pattern after that pattern's effective range ends.
			patternById: new Map(live(patternRows).map((row) => [row.id, row]))
		};
	});
}

/** Read current Work, source-month allowance rosters, and their exact retained holiday evidence. */
export function prepareWorkInputs(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly employmentIds: readonly string[];
	readonly complianceSpan: PayRange;
	readonly allowanceConfigurations: ReadonlyMap<string, Configuration>;
	readonly allowanceMonthsByEmployment: ReadonlyMap<string, ReadonlySet<string>>;
}): Effect.Effect<{
	readonly workDaysByEmployment: ReadonlyMap<string, EmploymentBundle['workDays']>;
	readonly workHolidayEvidence: GatheredRun['workHolidayEvidence'];
}> {
	return Effect.gen(function* () {
		const { complianceSpan, allowanceConfigurations, allowanceMonthsByEmployment } = options;
		const db = options.api.db;
		const approved = { approval_id: { isNull: true } } as const;
		const workDayRows = yield* db.work_days.findMany({
			where: {
				employment_id: { in: [...options.employmentIds] },
				work_date: { gte: complianceSpan.start, lte: complianceSpan.end },
				...approved
			},
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(workDayRows, 'work days');
		const historicalWorkDays: Array<EmploymentBundle['workDays'][number]> = [];
		for (const [sourceMonth, source] of allowanceConfigurations) {
			if (source.work.proration.by !== 'WORKING_DAYS') continue;
			const span = monthBounds(sourceMonth);
			const rows = yield* db.work_days.findMany({
				where: {
					employment_id: {
						in: [...allowanceMonthsByEmployment]
							.filter(([, months]) => months.has(sourceMonth))
							.map(([id]) => id)
					},
					work_date: { gte: span.start, lte: span.end },
					...approved
				},
				limit: PAGE_LIMIT
			});
			options.api.reads.assertComplete(rows, 'Allowance source-month work days');
			historicalWorkDays.push(...live(rows));
		}
		const workDays = new Map(
			[...live(workDayRows), ...historicalWorkDays].map((row) => [row.id, row])
		);
		// A day that was classified as a holiday pins it; read those holidays back whole, published
		// or not, because the pin is what the day was. An unpinned day takes whatever is published
		// at the point of running.
		const pinnedDays = [...workDays.values()].filter((row) => row.holiday_id != null);
		const workHolidays = pinnedDays.length
			? yield* db.jurisdiction_holidays.findMany({
					where: {
						id: { in: [...new Set(pinnedDays.map((row) => row.holiday_id!))] },
						...approved
					},
					limit: PAGE_LIMIT
				})
			: [];
		options.api.reads.assertComplete(workHolidays, 'Work holidays');
		const holidayById = new Map(live(workHolidays).map((row) => [row.id, row]));
		const workHolidayInputs = pinnedDays.map((row) => {
			const holiday = holidayById.get(row.holiday_id!);
			const date = requiredDateKey(row.work_date, 'work_days.work_date');
			if (!holiday) refuse(`Work day ${date} pins a missing holiday.`);
			return { company_id: holiday.company_id, date, holiday_id: holiday.id };
		});
		return {
			workDaysByEmployment: Map.groupBy([...workDays.values()], (row) => row.employment_id),
			workHolidayEvidence: { inputs: workHolidayInputs, holidays: live(workHolidays) }
		};
	});
}

/**
 * The total-work-hours boundary past which overtime is reclassified as excess.
 *
 * It is the jurisdiction's own ceiling — Malaysia's twelve hours under EA 1955 s.60A(7) — and not a
 * number a company configures. It used to be read off the `after_total_work_hours` field of the
 * overflow components, which meant a company could quietly move a statutory boundary, and two
 * of them in the same country could disagree about where it sits.
 */
function dailyTotalWorkLimit(configuration: Configuration): number | null {
	const limits = statutoryLimits(configuration).filter(
		(limit) => limit.period === 'DAY' && limit.measures === 'TOTAL_WORK_HOURS'
	);
	if (limits.length > 1)
		throw new Error('More than one daily work limit is effective for this jurisdiction.');
	return limits[0] == null ? null : decodeNumber(limits[0].max_hours);
}

/**
 * The ordinary-day overtime-hours ceiling (Vietnam / Indonesia's four hours).
 *
 * Distinct from `dailyTotalWorkLimit`: that one measures every clocked hour, this one measures
 * derived overtime hours. A jurisdiction that states neither has no daily reclassification.
 */
export function dailyOvertimeHoursLimit(configuration: Configuration): number | null {
	const limits = statutoryLimits(configuration).filter(
		(limit) => limit.period === 'DAY' && limit.measures === 'OVERTIME_HOURS'
	);
	if (limits.length > 1)
		throw new Error('More than one daily overtime-hours limit is effective for this jurisdiction.');
	return limits[0] == null ? null : decodeNumber(limits[0].max_hours);
}

/** The statute's ceilings: every limit that is not an INCENTIVE boundary. */
function statutoryLimits(configuration: Configuration) {
	return configuration.overtimeLimits.filter((limit) => limit.on_exceed !== 'INCENTIVE');
}

/**
 * The regime's INCENTIVE boundary, in hours worked on an ordinary day, or null where the lineage
 * states none and the statutory ceilings classify. Nihon's forked lineage states 11.
 */
function incentiveBoundary(configuration: Configuration): number | null {
	const limits = configuration.overtimeLimits.filter((limit) => limit.on_exceed === 'INCENTIVE');
	if (limits.length > 1)
		throw new Error('More than one INCENTIVE boundary is effective for this jurisdiction.');
	return limits[0] == null ? null : decodeNumber(limits[0].max_hours);
}

function monthlyOvertimeLimit(configuration: Configuration): number | null {
	const limits = statutoryLimits(configuration).filter(
		(limit) => limit.period === 'MONTH' && limit.measures === 'OVERTIME_HOURS'
	);
	if (limits.length > 1)
		throw new Error('More than one monthly overtime limit is effective for this jurisdiction.');
	return limits[0] == null ? null : decodeNumber(limits[0].max_hours);
}

/** Everything `isStatutoryOvertimePayCovered` tests: the jurisdiction's rule and one employment's facts. */
type StatutoryOvertimeCoverageOptions = {
	readonly rule: OvertimeCoverageRule | null;
	readonly jurisdictionCode: string;
	readonly wages: Partial<Record<WageBasis, MoneyValue>>;
	readonly statutoryWorkCategory: string | null;
	readonly workClassification: string | null;
	readonly employeeNumber: string;
	/** The Work catalogue's citation, quoted when the rule cannot be applied. */
	readonly authority?: string | null;
};

/**
 * Statutory OT / rest-day / holiday pay coverage, from the jurisdiction's own cited rule.
 *
 * The wage figures are passed in by basis, each filed under the basis it genuinely is. The caller
 * can produce both: `BASE_SALARY` from the employment terms, and `STATUTORY_WAGES` derived per
 * Employment Act 1955 s.2 as narrowed by First Schedule para 3 — basic plus every other cash
 * payment for work done, less overtime pay — from the components and their entries settling
 * in this run (see `deriveStatutoryWages`). A rule is only ever answered from the basis it names.
 */
export function isStatutoryOvertimePayCovered(options: StatutoryOvertimeCoverageOptions): boolean {
	const decision = decideOvertimeCoverage(options.rule, {
		statutoryWorkCategory: options.statutoryWorkCategory,
		workClassification: options.workClassification,
		wages: options.wages
	});
	if (decision.outcome !== 'UNDETERMINED') return decision.outcome === 'COVERED';

	// There is no warning tier left — every run issue fails the run — so an input the rule needs and
	// the engine cannot supply stops payroll and names itself, rather than being quietly rounded to
	// a boolean that decides someone's overtime.
	const authority = options.authority ?? 'the effective coverage rule';
	if (decision.reason === 'CEILING_CURRENCY_MISMATCH')
		throw new Error(
			`${options.employeeNumber}: the ${options.jurisdictionCode} overtime coverage ceiling is ` +
				`stated in a different currency from their wages, so it cannot be applied. Authority: ${authority}.`
		);
	throw new Error(
		`${options.employeeNumber}: the ${options.jurisdictionCode} overtime coverage rule tests ` +
			`${decision.requiredBasis === 'STATUTORY_WAGES' ? 'statutory wages' : 'base salary'}, and this ` +
			'run could not produce that figure for them. Record the statutory comparand required by ' +
			'the effective coverage rule. ' +
			`Authority: ${authority}.`
	);
}

function termsIdentity(terms: EmploymentBundle['terms'][number]): string {
	return typeof terms.id === 'string' && terms.id !== '' ? terms.id : termsSnapshotKey(terms);
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

const PAY_FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;

export function payFrequency(value: string | null): RateTerms['pay_frequency'] {
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
	return {
		work_days: workDays,
		paid_minutes: paidMinutes,
		reference_days: referenceDays,
		average_weekly_paid_minutes: (paidMinutes * 7) / referenceDays
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
	const workload = patternWorkload(
		termPattern(options.terms, options.configuration.patternById),
		options.configuration.shiftById
	);
	return (
		workload ??
		rosteredWorkload({
			days: options.workDays,
			configuration: options.configuration,
			window: options.window
		})
	);
}

function asRateTerms(
	terms: EmploymentBundle['terms'][number],
	workload: PatternWorkload
): RateTerms {
	const salary = baseSalaryOf(terms);
	const frequency = payFrequency(terms.pay_frequency);
	// Ad-hoc DAILY/HOURLY with no scheduled days has no weekly pattern to annualise from. Base
	// pay is earned units and never touches this, so the fallback only resolves the overtime and
	// day-wage rates against a neutral five-day, forty-hour week. Monthly staff never land here:
	// a MONTHLY rostered zero is refused at precheck, and a patterned zero keeps the historical
	// throw in `normalDailyHours`.
	const adHocZero = workload.work_days <= 0 && (frequency === 'DAILY' || frequency === 'HOURLY');
	const workingDaysPerWeek = adHocZero ? 5 : (workload.work_days * 7) / workload.reference_days;
	return {
		base_salary: { value: decodeNumber(salary.value), currency: salary.currency },
		pay_frequency: frequency,
		ordinary_hours_per_week: adHocZero ? 40 : workload.average_weekly_paid_minutes / 60,
		working_days_per_week: workingDaysPerWeek
	};
}

function baseSalaryOf(terms: EmploymentBundle['terms'][number]) {
	const salary = terms.base_salary;
	if (salary == null)
		throw new Error('Employment terms carry no base salary, so no rate can be derived from them.');
	return salary;
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
	const start = dateKey(terms.effective_range?.start) ?? '';
	const title =
		terms.job_title == null || terms.job_title === '' ? terms.employment_type : terms.job_title;
	return `${title} @ ${start} · ${decodeNumber(terms.base_salary?.value ?? 0).toFixed(2)}`;
}

/**
 * A day in lieu prices as an ordinary day.
 *
 * Holiday and rest-day work prices on the statute's premium ladder — except when the day chose
 * lieu: the leave credit is the compensation, so the clocks price as an ordinary day. Hours past
 * the shift still price as overtime, at ordinary rates; only the premium ladder is forgone.
 * Everything else the schedule resolved — the shift, the normal hours — is untouched.
 */
export function pricedDay(
	entry: { readonly compensation?: string | null },
	day: ScheduledDay
): ScheduledDay {
	if (entry.compensation !== 'LIEU') return day;
	if (
		day.dayType !== 'PUBLIC_HOLIDAY' &&
		day.dayType !== 'SPECIAL_HOLIDAY' &&
		day.dayType !== 'REST_DAY'
	)
		return day;
	return { ...day, dayType: 'ORDINARY' };
}

/** Prepare schedule and rates before money-family totals determine statutory overtime coverage. */
export function prepareWorkContext(
	options: Pick<MeasureEmploymentOptions, 'bundle' | 'configuration' | 'salary'> & {
		readonly employed: PayRange;
	}
) {
	const { bundle, configuration, employed } = options;
	const attendance = bundle.attendance;
	const wageDays = bundle.wageDays ?? employed;
	const closingTerms = termsAt(bundle, employed.end);
	const closingWorkload = termsWorkload({
		terms: closingTerms,
		configuration,
		workDays: bundle.workDays,
		window: options.salary
	});
	const rateTerms = asRateTerms(closingTerms, closingWorkload);
	const currency = rateTerms.base_salary.currency;

	// ── schedule across the full calendar months touched by the settlement cutoff ───────────────
	const complianceWindow: PayRange = {
		start: monthBounds(monthKey(attendance.start)).start,
		end: monthBounds(monthKey(attendance.end)).end
	};
	const attendanceDays = daysBetween(complianceWindow.start, complianceWindow.end);
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
		return {
			work_pattern: termPattern(row, configuration.patternById),
			// A rostered zero carries no weekly pattern; the day length falls back to the same
			// neutral eight hours the rate terms resolve against.
			normal_daily_hours:
				workload.work_days > 0 ? workload.paid_minutes / workload.work_days / 60 : 8
		};
	};
	const schedule = resolveSchedule({
		window: complianceWindow,
		dates: attendanceDays,
		terms: scheduleTermsAt,
		workDays: bundle.workDays,
		configuration
	});

	// Proration asks how many days the person was meant to work, not how many they attended. Source
	// rosters mark an approved leave day OFF because there is no shift to clock; using that mark as
	// the divisor makes a whole-month absence have zero working days and therefore no price. Remove
	// those leave-day marks so the contractual week supplies the missed schedule, while retaining
	// genuine roster rotations on every other day. Resolve each requested window independently:
	// salary proration needs the whole calendar month even though overtime only reads the cutoff
	// attendance window, and deferred joiners can ask for the previous month.
	const coverage = leaveCoverage(bundle.leave, complianceWindow);
	const takenLeaveDates = new Set(Object.keys(coverage.days));
	const prorationWorkDays = bundle.workDays.filter(
		(row) => !takenLeaveDates.has(requiredDateKey(row.work_date, 'work_days.work_date'))
	);
	const workingDaysCache = new Map<string, number>();
	const workingDaysIn = (window: PayRange): number => {
		const key = `${window.start}:${window.end}`;
		const cached = workingDaysCache.get(key);
		if (cached != null) return cached;
		const dates = daysBetween(window.start, window.end);
		const prorationSchedule = resolveSchedule({
			window,
			dates,
			terms: scheduleTermsAt,
			workDays: prorationWorkDays,
			configuration
		});
		const days = dates.filter((date) => prorationSchedule.get(date)?.dayType === 'ORDINARY').length;
		workingDaysCache.set(key, days);
		return days;
	};

	/**
	 * A day of pay *withheld* is not a day of pay *earned*, and the two use different divisors.
	 *
	 * `ordinary_day_wage` divides by `ordinary_rate.divisor` — 26 in Malaysia, EA s.60I — because that
	 * is the basis the Act sets for what an extra day of work is worth. Withholding pay for a day not
	 * worked is proration, and proration is `work_catalogue.proration`: the month's calendar days here,
	 * working days elsewhere. Valuing an absence at the overtime divisor over-deducts by the ratio
	 * between them — 31/26, about 19%, on every employee with unpaid leave.
	 *
	 * Rounded to the cent before it is multiplied by the day count, not after, which is what the
	 * source system does and what reproduces its figures exactly.
	 */
	const absenceDayWage = absenceDayRate({
		terms: rateTerms,
		work: configuration.work,
		period: options.salary,
		workingDaysIn
	});

	const subject = personContext({
		employee: bundle.employee,
		employment: bundle.employment,
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
		asOf: options.salary.end
	});

	// The overtime hour is the jurisdiction's ordinary hourly rate and nothing a company chooses:
	// the first ordinary-rate row that covers this person, a WORKING_DAYS divisor being the pay
	// month's scheduled working days.
	const ordinaryRate = resolveOrdinaryRate({
		rows: configuration.work.ordinary_rate,
		person: subject,
		workingDays: () => workingDaysIn(monthBounds(monthKey(options.salary.start))),
		employeeNumber: bundle.employment.employee_number
	});
	const hourlyRate = ordinaryHourlyRate(rateTerms, configuration.work, ordinaryRate);
	const dayWage = ordinaryDayWage(rateTerms, configuration.work, ordinaryRate);

	const absenceRate = (charge: LeaveCharge): number => {
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
		const terms = asRateTerms(term, workload);
		if (terms.base_salary.currency !== currency)
			throw new Error('Leave absence rate has a different currency from payroll.');
		if (terms.pay_frequency === 'DAILY') return terms.base_salary.value;
		if (terms.pay_frequency === 'HOURLY') {
			const shift = configuration.shiftById.get(charge.shift_definition_id);
			const hours = shift == null ? null : workWindow(shift.variant);
			if (hours == null) throw new Error('Hourly Leave requires its captured working shift.');
			return (terms.base_salary.value * hours.paid_minutes) / 60;
		}
		return absenceDayRate({ terms, work: configuration.work, period, workingDaysIn });
	};

	return {
		attendance,
		wageDays,
		closingTerms,
		rateTerms,
		currency,
		hourlyRate,
		dayWage,
		ordinaryRate,
		complianceWindow,
		schedule,
		coverage,
		workingDaysIn,
		absenceDayWage,
		subject,
		absenceRate
	};
}

/** Price Work attendance using the money families' prepared period totals for wage coverage. */
export function calculateWorkAttendance(
	options: Pick<MeasureEmploymentOptions, 'bundle' | 'configuration'> & {
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
		coverage,
		subject,
		rateTerms,
		closingTerms,
		absenceDayWage,
		hourlyRate,
		dayWage
	} = options.work;
	// ── overtime, derived from clocks and split beyond the jurisdiction's own daily ceilings ───
	//
	// `worked_intervals` is the presence test for the actual half of a work day: NULL means no
	// attendance was recorded at all, while an empty array means the day was read and nothing was
	// worked. Only the second is attendance, and only attendance can be priced or claimed — a day
	// carrying nothing but a plan has no clock to derive an hour from and no punch to freeze.
	const attendedDays = bundle.workDays.filter((day) => day.worked_intervals != null);
	const dailyWorkLimit = dailyTotalWorkLimit(configuration);
	const dailyOvertimeLimit = dailyOvertimeHoursLimit(configuration);
	// Overtime settles in the window the hours fall in: this employment's own attendance window.
	const overtimeAttendance = attendance;
	const overtimeDays: DailyOvertime[] = [];
	const segments: PricedSegment[] = [];
	const excess: ExcessHours[] = [];
	for (const entry of attendedDays) {
		const workDate = requiredDateKey(entry.work_date, 'work_days.work_date');
		if (workDate < complianceWindow.start || workDate > complianceWindow.end) continue;
		const day = schedule.get(workDate);
		if (!day) continue;
		// The statutory rest break reaches pay here and nowhere else. It reduces payable overtime only
		// where the jurisdiction states the break is not working time; where the statute is silent —
		// Malaysia — it is assessed, carried for reporting, and priced at nothing.
		// A lieu day forgone its premium at the roster: price the clocks ordinary.
		const derived = deriveDailyOvertime(entry, pricedDay(entry, day), configuration.restBreakRules);
		if (derived) overtimeDays.push(derived);
	}
	// The wage the ceiling is measured against is derived per Employment Act 1955 s.2 as narrowed by
	// First Schedule para 3 — basic plus every other cash payment for work done, less overtime pay —
	// from the employee's own components and entries. Only components this employment is eligible
	// for count: an allowance someone is not entitled to is not part of their wages.
	const statutoryWages = deriveStatutoryWages({
		baseSalary: rateTerms.base_salary,
		payments: configuration.catalogueComponents
			.filter((component) => isEligible(component.eligibility, subject))
			.map((component) => ({
				category: classifyWageComparand(component),
				amount: entryTotalByComponentId.get(component.id) ?? 0
			}))
	});
	const paymentEligible = isStatutoryOvertimePayCovered({
		rule: configuration.overtimeCoverageRule,
		jurisdictionCode: countryOf(configuration.jurisdiction.code),
		wages: {
			BASE_SALARY: rateTerms.base_salary,
			STATUTORY_WAGES: statutoryWages
		},
		statutoryWorkCategory: closingTerms.statutory_work_category,
		workClassification: closingTerms.work_classification,
		employeeNumber: bundle.employment.employee_number,
		authority: configuration.work.authority
	});
	const classifiedOvertime = classifyOvertimeByCalendarMonth({
		days: overtimeDays,
		dailyWorkLimit,
		dailyOvertimeHoursLimit: dailyOvertimeLimit,
		monthlyOrdinaryOvertimeLimit: monthlyOvertimeLimit(configuration),
		ordinaryDayIncentiveBoundary: incentiveBoundary(configuration)
	});
	if (paymentEligible) {
		for (const classified of classifiedOvertime) {
			if (
				classified.day.date < overtimeAttendance.start ||
				classified.day.date > overtimeAttendance.end
			)
				continue;
			const priced = priceDay({
				day: classified.day,
				rules: configuration.overtimeRules,
				retainedHours: classified.retainedHours
			});
			segments.push(...priced.segments);
			excess.push(...priced.excess);
		}
	}
	const calendarMonthOvertimeHours = new Map<string, number>();
	for (const day of overtimeDays) {
		if (day.dayType !== 'ORDINARY' && day.dayType !== 'OFF_DAY') continue;
		const calendarMonth = monthKey(day.date);
		calendarMonthOvertimeHours.set(
			calendarMonth,
			(calendarMonthOvertimeHours.get(calendarMonth) ?? 0) + day.hours
		);
	}

	// ── absent days: a rostered day with no time entry ─────────────────────────────────────
	//
	// The rule, in the four cases it actually has:
	//
	//   no `work_days` row at all   the pattern's projection stands and the person worked it.
	//                               Attendance records exceptions, so silence is presence.
	//   a row with intervals        the intervals are the truth and the roster is not consulted.
	//   a row with no time entry    absent without leave, and one day comes off the salary.
	//   under approved leave        not absence at all — a paid leave pays and an unpaid one
	//                               deducts through that leave's own declared deduction.
	//
	// `null` and `[]` are the same answer here on purpose. They differ elsewhere — `[]` is a day
	// somebody reviewed and closed, `null` is a day nobody looked at, and the roster lock cares
	// about that difference — but by the time payroll reads a day inside its own attendance window,
	// a rostered day with no punch is a day the person did not work, however it came to be empty.
	// Treating `null` as a no-op meant a whole month of unpunched rostered days was paid in full.
	//
	// A REST or OFF day, a holiday, and a day outside the attendance window are all no-ops. DAILY
	// and HOURLY employments are not deducted here: their base pay is earned units, so an absent
	// day simply earns nothing (see below).
	const absentDays = bundle.workDays.flatMap((day) => {
		if (day.worked_intervals != null && day.worked_intervals.length > 0) return [];
		const date = requiredDateKey(day.work_date, 'work_days.work_date');
		if (date < attendance.start || date > attendance.end) return [];
		const uncovered = 1 - (coverage.days[date] ?? 0);
		if (uncovered <= 0) return [];
		const scheduled = schedule.get(date);
		if (scheduled?.shift == null || scheduled.dayType !== 'ORDINARY') return [];
		return [{ id: day.id, date, days: uncovered }];
	});
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
					days: absentDays
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
					const priced = day == null ? null : pricedDay(entry, day);
					const night = nightWindowHours(
						entry,
						nightPremium,
						priced != null && priced.dayType === 'ORDINARY' ? priced.shift : null
					);
					// Overtime hours add nothing where the person is outside statutory overtime pay.
					const overtime = paymentEligible ? night.overtime : 0;
					return night.ordinary + overtime > 0
						? [{ id: entry.id, ordinary: night.ordinary, overtime }]
						: [];
				});
	const nightShiftHours = nightDays.reduce((total, day) => total + day.ordinary + day.overtime, 0);
	const adjustments = [
		...measureOvertime({
			segments,
			excess,
			hourlyRate,
			dayWage,
			catalogueComponents: configuration.catalogueComponents
		}),
		...(nightPremium == null
			? []
			: measureNightPremium({
					premium: nightPremium,
					days: nightDays,
					hourlyRate,
					catalogueComponents: configuration.catalogueComponents,
					subject
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
			})
		])
	];
	return {
		adjustments,
		capturedWorkDayIds,
		overtimeDays,
		calendarMonthOvertimeHours,
		nightShiftHours
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
		| 'context'
	>
): Measurement | null {
	const definition = options.component.definition;
	if (definition == null)
		throw new Error(`Component ${options.component.code} has no definition to measure.`);
	const nature = options.component.nature;

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

	/**
	 * A `SCHEDULE` component is the contracted wage, and the calendar is recorded rather than folded
	 * away.
	 *
	 * A mid-period change is two terms rows, each prorated against the same full-period divisor.
	 * Both segments are written down — the terms row that covered them, the days, the divisor those
	 * days were taken over, the basis that counted them, and both the contract amount and the
	 * prorated result — and the base entry is their sum. That is the difference this restructure
	 * exists for: the old shape summed the two fractions into one line and threw the working away,
	 * so a payslip could not be re-read years after a jurisdiction changed how it prorates.
	 */
	const measureSchedule = (): Measurement | null => {
		const measured: {
			readonly segment: NonNullable<ReturnType<typeof prorationSegment>>;
			readonly termKey: string;
			readonly contract: number;
			readonly exact: number;
		}[] = [];
		const record = (
			terms: EmploymentBundle['terms'][number],
			covered: { readonly start: IsoDate; readonly end: IsoDate } | null
		): void => {
			const segment = prorationSegment({
				work: options.configuration.work,
				period: options.salary,
				covered,
				workingDaysIn: options.workingDaysIn
			});
			if (segment == null || segment.denominator <= 0 || segment.days <= 0) return;
			const contract = decodeNumber(baseSalaryOf(terms).value);
			measured.push({
				segment,
				termKey: termsSnapshotKey(terms),
				contract,
				exact: contract * (segment.days / segment.denominator)
			});
		};
		/**
		 * One terms row per calendar day, then collapse consecutive days. Independently clipping
		 * every overlapping terms row to the month produced two identical full-month segments and
		 * double BASIC whenever two history rows both covered the window.
		 */
		if (closingFrequency === 'DAILY' || closingFrequency === 'HOURLY') return measureEarned();
		const wageDates = daysBetween(options.employed.start, options.employed.end);
		if (wageDates.length > 0) {
			let runStart = wageDates[0]!;
			let runTerms = termsOn(runStart);
			for (let index = 1; index <= wageDates.length; index += 1) {
				const date = wageDates[index];
				const nextTerms = date == null ? null : termsOn(date);
				if (nextTerms != null && termsIdentity(nextTerms) === termsIdentity(runTerms)) continue;
				record(runTerms, { start: runStart, end: wageDates[index - 1]! });
				if (date == null || nextTerms == null) break;
				runStart = date;
				runTerms = nextTerms;
			}
		}
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
		const amount = cents(measured.reduce((total, entry) => total + entry.exact, 0));
		let allocated = 0;
		const segments: PayslipProration[] = measured.map((entry, index) => {
			const prorated =
				index === measured.length - 1 ? cents(amount - allocated) : cents(entry.exact);
			allocated = cents(allocated + prorated);
			return {
				term_key: entry.termKey,
				from: entry.segment.from,
				to: entry.segment.to,
				basis: entry.segment.basis,
				days: entry.segment.days,
				denominator: entry.segment.denominator,
				contract_amount: entry.contract,
				prorated_amount: prorated
			};
		});
		return {
			amount,
			base: [baseLine(options.component, nature, amount)],
			// A period one terms row covers whole is still one segment, and it is still recorded:
			// "31 of 31 days at the contract" is a statement, and a payslip that only carries it
			// sometimes is a payslip whose reader has to know when.
			proration: segments,
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
			const codeId =
				planByDate.get(date) ??
				patternRosterCodeId(termPattern(dayTerms, options.configuration.patternById), date);
			if (codeId == null) continue;
			const code = options.configuration.shiftById.get(codeId);
			if (code == null)
				throw new Error(`Schedule on ${date} names roster code ${codeId}, which does not exist.`);
			if (!coversDate(code.effective_range, date))
				throw new Error(`Roster code ${code.code} is not effective on ${date}.`);
			if (rosterCodeKind(code.variant) !== 'WORK') continue;
			const shift = { ...workWindow(code.variant)!, id: code.id, code: code.code };
			const scheduledHours = shift.paid_minutes / 60;
			// Leave covers its reserved share of ordinary hours, including an explicitly empty punch.
			// Work includes those units; unpaid Leave deducts its own share once at the actual rate.
			const hours =
				actual != null && intervals != null
					? Math.min(
							scheduledHours,
							ordinaryWorkedHours(actual, shift) + (leave[date] ?? 0) * scheduledHours
						)
					: scheduledHours;
			const rate = decodeNumber(baseSalaryOf(dayTerms).value);
			exact += frequency === 'DAILY' ? rate * (hours / scheduledHours) : hours * rate;
		}
		const amount = cents(exact);
		return {
			amount,
			base: [baseLine(options.component, nature, amount)],
			proration: [],
			adjustments: []
		};
	};

	/** A formula evaluates the prepared family context and emits one base amount. */
	const measureFormula = (
		definition: Extract<ComponentDefinition, { source: 'FORMULA' }>
	): Measurement | null => {
		const amount = evaluateFormula({
			code: options.component.code,
			expr: definition.expr,
			context: options.context()
		});
		if (amount === 0 && definition.unit !== 'RATE') return null;
		const magnitude = cents(Math.abs(amount));
		return {
			amount: magnitude,
			base: [baseLine(options.component, nature, magnitude)],
			proration: [],
			adjustments: []
		};
	};

	switch (definition.source) {
		case 'SCHEDULE':
			return measureSchedule();
		case 'ENTRY':
			throw new Error('Work cannot measure a money-entry component.');
		case 'FORMULA':
			return measureFormula(definition);
		// Priced by the regime from work days (`measureOvertime`), never by the catalogue walk: the
		// row exists so the scheme treatments of derived overtime live where every treatment does.
		case 'ABSENCE':
		case 'DERIVED_OVERTIME':
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
	return options.days.map((day) => ({
		input: { family: 'WORK_DAY' as const, id: day.id },
		catalogueComponent: component,
		nature: component.nature,
		label: component.code,
		amount: cents(options.dayWage * day.days),
		quantity: day.days,
		rate: cents(options.dayWage),
		statutoryRuleKey: null
	}));
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
	}[];
	readonly hourlyRate: number;
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly subject: PersonContext;
}): MeasuredAdjustment[] {
	if (options.days.length === 0) return [];
	const component = options.catalogueComponents.find(
		(row) => row.family === 'WORK' && row.output === 'night'
	);
	if (component == null) throw new Error('Work catalogue is missing its night premium output.');
	if (!isEligible(component.eligibility, options.subject)) return [];
	const { ordinary_add, overtime_add } = options.premium;
	return options.days.flatMap((day) => {
		const amount = cents(
			options.hourlyRate * ((day.ordinary * ordinary_add + day.overtime * overtime_add) / 100)
		);
		if (amount === 0) return [];
		return [
			{
				input: { family: 'WORK_DAY' as const, id: day.id },
				catalogueComponent: component,
				nature: 'EARNING' as const,
				label: component.code,
				amount,
				quantity: day.ordinary + day.overtime,
				rate: options.hourlyRate,
				statutoryRuleKey: null
			}
		];
	});
}

/**
 * Overtime, priced from the clocks and the statute and from nothing else.
 *
 * Every hour that reached this point has already been derived from a work day, classified against
 * the daily and calendar-month controls, and valued by one band of the jurisdiction's
 * `overtime_rules`. An adjustment is one band's segments **on one day** summed: the band triple —
 * day type, measure, band floor — plus the excess flag is the whole of what identifies the rule,
 * and it is what the row carries in place of a component, because there is no component. A
 * company cannot add an overtime band, remove one, or pay a different multiple for one; those are
 * the statute's to say.
 *
 * ## Why the day is part of the grouping now
 *
 * The pre-restructure lines had no causal input, so a line could be one band's worth of a whole month. A
 * `payslip_adjustments` row points at exactly ONE work day, and a row that summed five days could
 * name only one of them — so the grouping is `(work day x band)` and a month produces more rows
 * than it used to. That is the correct number: each one is a claim over the clock that priced it,
 * and the settlement lock is the row rather than a second collection.
 *
 * The valuation is the arithmetic exactly as it was when a component owned it:
 *
 * - hourly awards accumulate multiplier-weighted hours and are priced once against the
 *   jurisdiction's ordinary hourly rate, while stepped day-wage awards accumulate day-wage
 *   multiples.
 * - a band that comes out at zero produces no row at all, not a zero one. The day is still
 *   captured: it falls through to the junction row `measureEmployment` stores for every day it read
 *   and priced at nothing.
 */
/**
 * Everything `measureOvertime` prices: the classified segments and the rates they were derived at.
 */
type MeasureOvertimeOptions = {
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly segments: readonly PricedSegment[];
	readonly excess: readonly ExcessHours[];
	readonly hourlyRate: number;
	readonly dayWage: number;
};

function measureOvertime(options: MeasureOvertimeOptions): MeasuredAdjustment[] {
	const rows: MeasuredAdjustment[] = [];
	const asAdjustment = (
		band: OvertimeBandIdentity,
		workDayId: string,
		excess: boolean,
		measurement: { amount: number; quantity: number; rate: number }
	): MeasuredAdjustment => {
		const ruleKey = overtimeBandCode({ excess, ...band });
		const component = options.catalogueComponents.find(
			(row) => row.family === 'WORK' && row.output === (excess ? 'overtime_excess' : 'overtime')
		);
		if (component == null) throw new Error('Work catalogue is missing its overtime output.');
		return {
			input: { family: 'WORK_DAY', id: workDayId },
			catalogueComponent: component,
			nature: 'EARNING',
			label: ruleKey,
			amount: measurement.amount,
			quantity: measurement.quantity,
			rate: measurement.rate,
			// Output provenance: the band triple plus the excess flag is the whole of what identifies
			// the rule, and together with the run's `statutory_snapshot_id` it identifies the applied
			// rule exactly. The band itself lives in the run's statutory snapshot.
			statutoryRuleKey: ruleKey
		};
	};

	for (const [key, matched] of groupByDayAndBand(options.segments)) {
		let hours = 0;
		let weighted = 0;
		let dayWageAmount = 0;
		for (const segment of matched) {
			hours += segment.hours;
			if (segment.award === 'DAY_WAGE_MULTIPLE') {
				dayWageAmount += segment.multiple * options.dayWage;
				continue;
			}
			weighted += segment.hours * segment.multiple;
		}
		const amount = cents(weighted * options.hourlyRate + dayWageAmount);
		if (amount === 0) continue;
		rows.push(
			asAdjustment(key.band, key.workDayId, false, {
				amount,
				quantity: hours,
				rate: options.hourlyRate
			})
		);
	}

	for (const [key, matched] of groupByDayAndBand(options.excess)) {
		const valuedAt = matched[0]!.valuedAt;
		if (matched.some((row) => row.valuedAt !== valuedAt))
			throw new Error(
				`The ${overtimeBandCode({ excess: true, ...key.band })} band produced excess hours valued ` +
					'both as an hourly award and as a day wage. One band values its hours one way.'
			);
		// Units are already the legal value factor: multiplier-weighted hours for hourly awards,
		// or the incremental statutory day-wage multiple for a stepped flat award.
		const units = matched.reduce((total, row) => total + row.units, 0);
		const hours = matched.reduce((total, row) => total + row.hours, 0);
		const rate = valuedAt === 'ORDINARY_DAY_WAGE' ? options.dayWage : options.hourlyRate;
		const amount = cents(units * rate);
		if (amount === 0) continue;
		rows.push(asAdjustment(key.band, key.workDayId, true, { amount, quantity: hours, rate }));
	}

	return rows;
}

/**
 * Priced rows collected under the work day and the band that valued them, first-seen order.
 *
 * Order is the days' order, which is stable for the same clocks; nothing about the money depends on
 * it, but a payslip whose row order moved between two identical builds would look like a change.
 *
 * The day is in the key because a `payslip_adjustments` row names exactly one source. A month's
 * worth of one band used to be one line; it is now one row per day, which is more rows and the
 * right ones — each is the claim over the clock that priced it.
 */
function groupByDayAndBand<T extends OvertimeBandIdentity & { readonly workDayId: string }>(
	rows: readonly T[]
): Map<{ band: OvertimeBandIdentity; workDayId: string }, T[]> {
	const byKey = new Map<
		string,
		{ key: { band: OvertimeBandIdentity; workDayId: string }; rows: T[] }
	>();
	for (const row of rows) {
		const key = `${row.workDayId}:${row.dayType}:${row.measure}:${row.bandFrom}`;
		const bucket = byKey.get(key);
		if (bucket) bucket.rows.push(row);
		else
			byKey.set(key, {
				key: {
					band: { dayType: row.dayType, measure: row.measure, bandFrom: row.bandFrom },
					workDayId: row.workDayId
				},
				rows: [row]
			});
	}
	return new Map([...byKey.values()].map((entry) => [entry.key, entry.rows]));
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
					}))
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
 * A quarter or a year is counted to date: what earlier PAID payslips of this person settled for
 * the same months, plus this run.
 */
export function validateWorkResult(options: {
	readonly configuration: Configuration;
	readonly measured: MeasuredEmployment;
	/** Regulated overtime hours earlier PAID payslips settled, by calendar month. */
	readonly priorOvertimeHours?: ReadonlyMap<string, number>;
}): RunIssue[] {
	const { configuration, measured } = options;
	const { bundle } = measured;
	const issues: RunIssue[] = validateAbsenceTreatments({
		configuration,
		adjustments: measured.adjustments
	});
	issues.push(
		...validateOvertimeLimits({
			configuration,
			employeeNumber: bundle.employment.employee_number,
			hoursByMonth: measured.calendarMonthOvertimeHours,
			priorHoursByMonth: options.priorOvertimeHours ?? new Map()
		})
	);
	// The daily ceiling is the jurisdiction's, read from its regime where `period = 'DAY'`.
	// It used to be a literal 12 here, which meant Malaysia's cap was applied to every country in
	// the workspace. A jurisdiction that states no daily limit now has none enforced, rather than
	// inheriting one from a statute that does not govern it.
	const dailyWorkLimit = dailyTotalWorkLimit(configuration);
	if (dailyWorkLimit != null)
		issues.push(
			...validateDailyWorkLimit({
				employeeNumber: bundle.employment.employee_number,
				days: measured.overtimeDays,
				maxWorkHours: dailyWorkLimit
			})
		);
	const dailyOvertimeLimit = dailyOvertimeHoursLimit(configuration);
	if (dailyOvertimeLimit != null)
		issues.push(
			...validateDailyOvertimeHoursLimit({
				employeeNumber: bundle.employment.employee_number,
				days: measured.overtimeDays,
				maxOvertimeHours: dailyOvertimeLimit
			})
		);
	return issues;
}
