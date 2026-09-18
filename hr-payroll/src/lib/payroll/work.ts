/** Work owns schedules, contracted wages, attendance, and the rates supplied to Leave. */
import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { offsetMinutesFor } from '../timezone.js';
import type { MoneyValue } from '@norbital-ai/std/finance';
import { decodeNumber } from '@norbital-ai/std/json';
import type {
	CatalogueComponent,
	Configuration
} from '../../collections/payroll_runs/lib/configuration.js';
import type { EmploymentBundle, GatheredRun } from '../../collections/payroll_runs/lib/gather.js';
import {
	PAGE_LIMIT,
	type PayrollReadApi,
	type ReadLog
} from '../../collections/payroll_runs/lib/api.js';
import type { ComponentDefinition } from '../../collections/payroll_runs/lib/configuration.js';
import type { PayslipProration } from '../../datatypes/payslip_proration/+definition.js';
import type { LeaveCharge } from '../../datatypes/leave_charges/+definition.js';
import {
	classifyWageComparand,
	deriveStatutoryWages
} from '../../collections/payroll_runs/lib/statutory-wages.js';
import {
	dateKey,
	daysBetween,
	inclusiveDays,
	monthBounds,
	monthKey,
	requiredDateKey,
	type IsoDate
} from '../../collections/payroll_runs/lib/dates.js';
import {
	coversDate,
	live,
	overlapsRange,
	readRange
} from '../../collections/payroll_runs/lib/effective.js';
import { addDays, weekStart } from '../period.js';
import {
	evaluatePersonNumber,
	isEligible,
	personContext,
	type PersonContext
} from '../../collections/payroll_runs/lib/eligibility.js';
import { stint } from '../employment-contract.js';
import {
	dailyWorkedHours,
	deriveDailyOvertime,
	ordinaryWorkedHours,
	nightWindowHours,
	type DailyOvertime
} from '../../collections/payroll_runs/lib/overtime.js';
import {
	INCENTIVE_LINE,
	OVERTIME_LINE,
	nightAddsFor,
	priceWorkDay,
	type WorkBandDay
} from './work-bands.js';
import {
	absenceDayRate,
	ordinaryDayWage,
	ordinaryHourlyRate,
	ordinaryDivisorDays,
	type RateTerms
} from '../../collections/payroll_runs/lib/ordinary-rate.js';
import { prorationSegment } from '../../collections/payroll_runs/lib/proration.js';
import { fixedAllowancesOn } from './money.js';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import { resolveSchedule } from '../../collections/payroll_runs/lib/schedule.js';
import { applicableLimits } from '../scheduling/work-limits.js';
import type { ScheduledDay } from '../../collections/payroll_runs/lib/schedule.js';
import { PAY_FREQUENCIES, type PayrollWindow } from '../../collections/payroll_runs/lib/period.js';
import {
	validateDailyOvertimeHoursLimit,
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
	patternAnchor,
	patternRosterCodeId,
	patternWorkload,
	termPattern,
	termPatternRow,
	type PatternWorkload
} from '../scheduling/work-pattern.js';
import { rosterCodeKind, workWindow } from '../scheduling/roster-code.js';
import { derivedBreakMinutes } from '../scheduling/rest-break.js';
import type {
	Measurement,
	MeasureComponentOptions,
	MeasuredAdjustment,
	MeasuredEmployment,
	MeasureEmploymentOptions,
	PayRange
} from './family.js';
import { baseLine, settlementBucket } from './family.js';

/** Work resolves its catalogue and the roster definitions used throughout the payroll window. */
export function prepareWorkCatalogue(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly jurisdiction: Configuration['jurisdiction'];
	readonly companyId: string;
	readonly windowStart: IsoDate;
	readonly windowEnd: IsoDate;
	/** The company's roster vocabulary, read once by the configuration and handed down. */
	readonly shiftRows: readonly WorkspaceRow<'shift_definitions'>[];
	readonly patternRows: readonly WorkspaceRow<'shift_patterns'>[];
}): Effect.Effect<
	Pick<
		Configuration,
		| 'work'
		| 'holidayRestPrecedence'
		| 'limits'
		| 'breaks'
		| 'nightPremium'
		| 'shiftById'
		| 'patternById'
	>
> {
	return Effect.gen(function* () {
		const { jurisdiction, windowStart, windowEnd, shiftRows, patternRows } = options;
		const work: Configuration['work'] = {
			...jurisdiction.work_rules,
			settings_id: jurisdiction.id,
			jurisdiction_code: jurisdiction.jurisdiction_code
		};
		const shifts = live(shiftRows).filter((row) =>
			overlapsRange(row.effective_range, windowStart, windowEnd)
		);
		return {
			work,
			holidayRestPrecedence: work.holiday_rest_precedence,
			limits: work.limits,
			breaks: work.breaks,
			nightPremium: work.night_premium ?? null,
			shiftById: new Map(shifts.map((row) => [row.id, row])),
			// A terms row still names its original pattern after that pattern's effective range ends.
			patternById: new Map(live(patternRows).map((row) => [row.id, row]))
		};
	});
}

/** Read current Work days and the monthly rosters of record over the span. */
export function prepareWorkInputs(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly employmentIds: readonly string[];
	readonly complianceSpan: PayRange;
}): Effect.Effect<{
	readonly workDaysByEmployment: ReadonlyMap<string, EmploymentBundle['workDays']>;
	readonly rostersByEmployment: ReadonlyMap<string, EmploymentBundle['rosters']>;
}> {
	return Effect.gen(function* () {
		const { complianceSpan } = options;
		const db = options.api.db;
		const approved = { approval_id: { isNull: true } } as const;
		const [workDayRows, rosterRows] = yield* Effect.all(
			[
				db.work_days.findMany({
					where: {
						employment_id: { in: [...options.employmentIds] },
						// A bare day as an upper bound is cast in the server's zone and lands before the
						// day's stored instant, dropping the span's last day; a leaver settled to month end
						// lost 28 February. Exclusive next-day bound instead, as the event pages read.
						work_date: { gte: complianceSpan.start, lt: addDays(complianceSpan.end, 1) },
						...approved
					},
					limit: PAGE_LIMIT
				}),
				// The rosters of record: one row per person-month. A cycle that straddles a month
				// boundary reads the two months it spans.
				db.rosters.findMany({
					where: {
						employment_id: { in: [...options.employmentIds] },
						period: { in: monthsSpanned(complianceSpan) },
						...approved
					},
					columns: { employment_id: true, period: true, approval_id: true },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(workDayRows, 'work days');
		options.api.reads.assertComplete(rosterRows, 'rosters');
		const rostersByEmployment = Map.groupBy(
			live(rosterRows).map((row) => {
				const bounds = monthBounds(row.period);
				return { employment_id: row.employment_id, start: bounds.start, end: bounds.end };
			}),
			(row) => row.employment_id
		);
		const workDays = new Map(live(workDayRows).map((row) => [row.id, row]));
		return {
			workDaysByEmployment: Map.groupBy([...workDays.values()], (row) => row.employment_id),
			rostersByEmployment: new Map(
				[...rostersByEmployment].map(([id, rows]) => [
					id,
					rows.map(({ start, end }) => ({ start, end }))
				])
			)
		};
	});
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
	/** The contract's `agreed_days_per_week`: the roster's normal week is its shift × these days. */
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
	const workload = patternWorkload(
		termPattern(options.terms, options.configuration.patternById),
		options.configuration.shiftById
	);
	return (
		workload ??
		rosteredWorkload({
			days: options.workDays,
			configuration: options.configuration,
			window: options.window,
			daysPerWeek: decodeNumber(options.terms.agreed_days_per_week)
		})
	);
}

function asRateTerms(
	terms: EmploymentBundle['terms'][number],
	workload: PatternWorkload
): RateTerms {
	const salary = baseSalaryOf(terms);
	const frequency = payFrequency(terms.pay_frequency);
	// No scheduled days is no weekly pattern to annualise hours from: an ad-hoc DAILY or HOURLY
	// month with no rows, or a deferred joiner priced through `measureArrears` over a window their
	// roster does not reach. Base pay is earned units or a proration and never touches this, so
	// the fallback only resolves the overtime and day-wage rates against a neutral forty-hour
	// week — at any frequency, because a zero here is an infinite hourly rate and a run refused
	// at the rounding step for an amount nobody can see.
	//
	// The days a week are the contract's own `agreed_days_per_week`, never counted off a pattern
	// or a roster: a rostered person is not ad hoc, and a divisor read off the days a roster
	// happened to hold priced the same salary at a different day rate every month.
	return {
		base_salary: { value: decodeNumber(salary.value), currency: salary.currency },
		pay_frequency: frequency,
		ordinary_hours_per_week:
			workload.work_days > 0 ? workload.average_weekly_paid_minutes / 60 : 40,
		working_days_per_week: decodeNumber(terms.agreed_days_per_week)
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
	// The statute's normal day, where the version states one (`work_rules.normal_hours`): a shift
	// longer than it is a normal day plus overtime. Read over the person on the closing terms.
	const normalHoursRule = (configuration.work.normal_hours ?? '').trim();
	const normalHoursCap =
		normalHoursRule === ''
			? Number.POSITIVE_INFINITY
			: evaluatePersonNumber(
					normalHoursRule,
					personContext({
						employee: bundle.employee,
						employment: stint(bundle.employment),
						terms: closingTerms,
						week: {
							ordinary_hours_per_week: rateTerms.ordinary_hours_per_week,
							working_days_per_week: rateTerms.working_days_per_week
						},
						children: bundle.children,
						company: configuration.company,
						asOf: options.salary.end
					})
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
		const patternRow = termPatternRow(row, configuration.patternById);
		return {
			work_pattern: patternRow?.pattern ?? null,
			pattern_anchor: patternAnchor(patternRow),
			// A rostered zero carries no weekly pattern; the day length falls back to the same
			// neutral eight hours the rate terms resolve against.
			normal_daily_hours: Math.min(
				normalHoursCap,
				workload.work_days > 0 ? workload.paid_minutes / workload.work_days / 60 : 8
			)
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
			rosters: bundle.rosters,
			configuration
		});
		// A public holiday that falls on a scheduled working day is a working day, in the numerator
		// and the divisor alike (SG EA s.20A / MOM: the days required to work "include public
		// holidays"; VN Decree 145/2020 art.54(1)(a) counts the same). One that falls on a rest day
		// is neither.
		const days = dates.filter((date) => {
			const day = prorationSchedule.get(date);
			return (
				day?.dayType === 'ORDINARY' || (day?.dayType === 'PUBLIC_HOLIDAY' && day.shift != null)
			);
		}).length;
		workingDaysCache.set(key, days);
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
		employment: stint(bundle.employment),
		// The standing allowances in force, so a divisor can price the hour over the monthly wage
		// (ID PP 35/2021 art.32: 1/173 of basic plus fixed allowances).
		fixedAllowances: fixedAllowancesOn(bundle.payRequests, options.salary.end),
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
	const hourlyRate = ordinaryHourlyRate(rateTerms, divisorDays);
	const dayWage = ordinaryDayWage(rateTerms, divisorDays);

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
		return absenceDayRate({
			terms,
			work: configuration.work,
			person: subject,
			period,
			workingDaysIn
		});
	};

	return {
		attendance,
		wageDays,
		closingTerms,
		rateTerms,
		currency,
		hourlyRate,
		dayWage,
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
	options: Pick<MeasureEmploymentOptions, 'bundle' | 'configuration' | 'priorOvertimeHours'> & {
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
	// Overtime settles in the window the hours fall in: this employment's own attendance window.
	const overtimeAttendance = attendance;
	const overtimeDays: DailyOvertime[] = [];
	const bandDays: WorkBandDay[] = [];
	const clockedDays = attendedDays
		.map((entry) => ({ entry, workDate: requiredDateKey(entry.work_date, 'work_days.work_date') }))
		.filter(
			({ workDate }) => workDate >= complianceWindow.start && workDate <= complianceWindow.end
		)
		.toSorted((left, right) => (left.workDate < right.workDate ? -1 : 1));
	// The limits that govern this person: a conditional one (`limits[].when`) applies only where
	// its predicate holds over them.
	const limits = applicableLimits(configuration.limits, subject);
	// The week's normal hours, where the version caps them (a `WEEK NORMAL_HOURS` limit: Singapore's
	// 44, s.38(1)). Hours inside the normal day but past the cap are overtime of the day they fall
	// on — a week of six 8-hour days earns its 45th to 48th hour at the ordinary-day band. The
	// running sum reads the days in order, Monday to Sunday, the week the schedule gate measures.
	const weeklyNormalCap =
		limits.find((limit) => limit.period === 'WEEK' && limit.measure === 'NORMAL_HOURS')
			?.max_hours ?? null;
	const weekNormalRunning = new Map<string, number>();
	for (const { entry, workDate } of clockedDays) {
		const day = schedule.get(workDate);
		if (!day) continue;
		// Attendance is priced as it happened: the break rule belongs to the schedule gate
		// (`work_rules.breaks`), not to the money.
		// The break is derived, never stored: the shift's granted break less the gaps the punches
		// already show. `deriveDailyOvertime` reads it off the entry like every other clock fact.
		const clocked = {
			...entry,
			break_minutes: derivedBreakMinutes(entry.worked_intervals, day.shift?.break_minutes ?? 0)
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
		let weeklyExcess = 0;
		if (weeklyNormalCap != null && day.dayType === 'ORDINARY') {
			const withinNormal = Math.min(Math.max(0, worked), day.normalHours);
			const week = weekStart(workDate);
			const running = (weekNormalRunning.get(week) ?? 0) + withinNormal;
			weekNormalRunning.set(week, running);
			weeklyExcess = Math.min(withinNormal, Math.max(0, running - weeklyNormalCap));
		}
		// An unworked holiday the person's calendar recorded (a day read and found empty) is a
		// band day of zero hours: the first band that holds prices it by amount — a regular
		// holiday's day wage (PH art.94), a holiday on a non-working day (SG s.88).
		const unworkedHoliday =
			daily == null &&
			worked <= 0 &&
			(day.dayType === 'PUBLIC_HOLIDAY' || day.dayType === 'SPECIAL_HOLIDAY');
		const derived =
			daily == null
				? weeklyExcess > 0 || unworkedHoliday
					? {
							date: workDate,
							workDayId: entry.id,
							dayType: day.dayType,
							hours: weeklyExcess,
							normalHours: day.normalHours,
							totalWorkHours: worked,
							breakMinutes: clocked.break_minutes,
							restBreak: null,
							restBreakDeductedHours: 0
						}
					: null
				: { ...daily, hours: daily.hours + weeklyExcess };
		if (!derived) continue;
		// A zero-hour holiday day is a band day, never an overtime day.
		if (derived.hours > 0) overtimeDays.push(derived);
		bandDays.push({
			workDayId: derived.workDayId,
			date: derived.date,
			dayType: derived.dayType,
			// Net of the unpaid statutory break the day owed and did not take: a rest-day clock the
			// break is not working time on is priced from the start over the payable hours.
			workedHours: derived.totalWorkHours - derived.restBreakDeductedHours,
			normalHours: derived.normalHours,
			overtimeHours: derived.hours,
			breakMinutes: clocked.break_minutes,
			rosterCode: day.shift?.code ?? '',
			holidayKind: configuration.holidays.get(workDate)?.kind ?? '',
			holidayName: configuration.holidays.get(workDate)?.name ?? '',
			monthOvertimeHours: 0,
			consecutiveHours: derived.restBreak?.longestRunHours ?? 0,
			continuousAttendance: false,
			restDay: day.restDay,
			offDay: day.offDay,
			nightHours:
				configuration.nightPremium == null
					? 0
					: (() => {
							const night = nightWindowHours(
								clocked,
								configuration.nightPremium,
								day.dayType === 'ORDINARY' ? day.shift : null,
								offset,
								derived.normalHours
							);
							return night.ordinary + night.overtime;
						})(),
			requestedBy: entry.requested_by ?? 'EMPLOYER'
		});
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
	// Who the overtime ladder covers is the version's own predicate over the person, read with the
	// statutory wage comparand this run derived.
	const paymentEligible = isEligible(configuration.work.overtime_when, {
		...subject,
		terms: { ...subject.terms, statutory_wages: statutoryWages.value }
	});
	// The running month counter a band reads as `month_overtime_hours`: regulated OT so far this
	// calendar month, including this day.
	const monthRunning = new Map<string, number>();
	const bandDaysWithMonths = [...bandDays]
		.toSorted((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0))
		.map((day) => {
			const month = monthKey(day.date);
			const regulated = day.dayType === 'ORDINARY' || day.dayType === 'OFF_DAY';
			const next = (monthRunning.get(month) ?? 0) + (regulated ? day.overtimeHours : 0);
			monthRunning.set(month, next);
			return { ...day, monthOvertimeHours: next };
		});
	const pricedBandDays = paymentEligible
		? bandDaysWithMonths.filter(
				(day) => day.date >= overtimeAttendance.start && day.date <= overtimeAttendance.end
			)
		: [];
	// The regulated-overtime ceiling governs the overtime the Act pays. A salaried engineer outside
	// the overtime rule has no regulated hours to cap, so the ceiling is not reported against them.
	const calendarMonthOvertimeHours = new Map<string, number>();
	for (const day of paymentEligible ? overtimeDays : []) {
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
					const night = nightWindowHours(
						entry,
						nightPremium,
						priced != null && priced.dayType === 'ORDINARY' ? priced.shift : null,
						offsetMinutesFor(configuration.jurisdiction.payroll.timezone, date),
						bandDay?.normalHours ?? priced?.normalHours ?? 0
					);
					// Overtime hours add nothing where the person is outside statutory overtime pay.
					const overtime = paymentEligible ? night.overtime : 0;
					if (night.ordinary + overtime <= 0) return [];
					// The adds follow the day where the version says so; a day the bands never saw
					// (outside the overtime window, or an ineligible person) reads the plain figures.
					const adds =
						bandDay == null
							? {
									ordinary:
										typeof nightPremium.ordinary_add === 'number' ? nightPremium.ordinary_add : 0,
									overtime:
										typeof nightPremium.overtime_add === 'number' ? nightPremium.overtime_add : 0
								}
							: nightAddsFor({
									work: { ...configuration.work, limits },
									premium: nightPremium,
									person: subject,
									day: bandDay,
									rates: { ordinaryHour: hourlyRate, ordinaryDay: dayWage, dayWage }
								});
					return [{ id: entry.id, ordinary: night.ordinary, overtime, adds }];
				});
	const nightShiftHours = nightDays.reduce((total, day) => total + day.ordinary + day.overtime, 0);
	const capped = funnelMonthlyOvertime({
		rows: measureWorkBands({
			work: { ...configuration.work, limits },
			person: subject,
			days: pricedBandDays,
			rates: { ordinaryHour: hourlyRate, ordinaryDay: dayWage, dayWage },
			catalogueComponents: configuration.catalogueComponents,
			currency: options.work.currency
		}),
		days: pricedBandDays,
		limits,
		prior: options.priorOvertimeHours ?? new Map(),
		catalogueComponents: configuration.catalogueComponents,
		currency: options.work.currency
	});
	for (const [month, hours] of capped.funnelledHours)
		calendarMonthOvertimeHours.set(month, (calendarMonthOvertimeHours.get(month) ?? 0) - hours);
	const adjustments = [
		...capped.rows,
		...(nightPremium == null
			? []
			: measureNightPremium({
					premium: nightPremium,
					days: nightDays,
					hourlyRate,
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
			})
		])
	];
	return {
		adjustments,
		capturedWorkDayIds,
		overtimeDays,
		calendarMonthOvertimeHours,
		nightShiftHours,
		/** The rostered days with no punch and no leave, for an allowance that loses unpaid days. */
		absentDays,
		/** The limits that govern this person, the conditional ones judged. */
		limits
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
	>
): Measurement | null {
	const definition = options.component.definition;
	if (definition == null)
		throw new Error(`Component ${options.component.code} has no definition to measure.`);
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
				// The basis is the person's: read over the terms row this segment prices.
				person: personContext({
					employee: options.bundle.employee,
					employment: stint(options.bundle.employment),
					fixedAllowances: fixedAllowancesOn(options.bundle.payRequests, options.salary.end),
					terms,
					children: options.bundle.children,
					company: options.configuration.company,
					asOf: options.salary.end
				}),
				period: options.salary,
				covered,
				workingDaysIn: options.workingDaysIn,
				instalments: terms.pay_frequency === 'SEMI_MONTHLY' ? 2 : 1
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
		/**
		 * A fixed factor caps the MONTH (or the instalment), not each terms row. Two rows split on
		 * the 24th measured 16 + 7 = 23 working days over 21.75 and paid 105.75% of a month; the
		 * DOLE factor is what a whole month is worth, so the rows are scaled to it together and
		 * the segments a payslip stores still sum to what was paid.
		 */
		const capped = ((): typeof measured => {
			if (measured.length < 2 || measured.some((entry) => entry.segment.basis.by !== 'FIXED_DAYS'))
				return measured;
			const cap = measured[0]!.segment.denominator / (closingFrequency === 'SEMI_MONTHLY' ? 2 : 1);
			const total = measured.reduce((sum, entry) => sum + entry.segment.days, 0);
			if (total <= cap) return measured;
			return measured.map((entry) => {
				const days = (entry.segment.days * cap) / total;
				return {
					...entry,
					segment: { ...entry.segment, days },
					exact: entry.contract * (days / entry.segment.denominator)
				};
			});
		})();
		const amount = cents(
			capped.reduce((total, entry) => total + entry.exact, 0),
			currency
		);
		let allocated = 0;
		const segments: PayslipProration[] = capped.map((entry, index) => {
			const prorated =
				index === capped.length - 1
					? cents(amount - allocated, currency)
					: cents(entry.exact, currency);
			allocated = cents(allocated + prorated, currency);
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
			base: [baseLine(options.component, bucket, amount)],
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
			const patternRow = termPatternRow(dayTerms, options.configuration.patternById);
			const codeId =
				planByDate.get(date) ??
				patternRosterCodeId(patternRow?.pattern ?? null, date, patternAnchor(patternRow));
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
			// A regular holiday not worked is still a paid day for the daily-paid (PH art.94: 100% of
			// the daily wage); an empty punch on it records nothing to deduct.
			const holidayUnit =
				options.configuration.holidays.get(date)?.kind === 'PUBLIC' &&
				(intervals == null || intervals.length === 0);
			const hours =
				actual != null && intervals != null && !holidayUnit
					? Math.min(
							scheduledHours,
							ordinaryWorkedHours(
								{
									...actual,
									break_minutes: derivedBreakMinutes(intervals, shift.break_minutes)
								},
								shift,
								offsetMinutesFor(options.configuration.jurisdiction.payroll.timezone, date)
							) +
								(leave[date] ?? 0) * scheduledHours
						)
					: scheduledHours;
			const rate = decodeNumber(baseSalaryOf(dayTerms).value);
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
		case 'ENTRY':
			throw new Error('Work cannot measure a money-entry component.');
		// Priced by the rules from work days (`measureOvertime`), never by the catalogue walk: the
		// row exists so the opt-ins of derived overtime live where every other opt-in does.
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
	return options.days.map((day) => ({
		input: { family: 'WORK_DAY' as const, id: day.id },
		catalogueComponent: component,
		bucket: settlementBucket(component.destination, component.direction),
		label: component.code,
		amount: cents(options.dayWage * day.days, options.currency),
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
		readonly adds: { readonly ordinary: number; readonly overtime: number };
	}[];
	readonly hourlyRate: number;
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
	return options.days.flatMap((day) => {
		const amount = cents(
			options.hourlyRate *
				((day.ordinary * day.adds.ordinary + day.overtime * day.adds.overtime) / 100),
			options.currency
		);
		if (amount === 0) return [];
		return [
			{
				input: { family: 'WORK_DAY' as const, id: day.id },
				catalogueComponent: component,
				bucket: settlementBucket(component.destination, component.direction),
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
 * Work bands, priced from the clocks and the version's own rules.
 *
 * Each day's facts go to `priceWorkDay`; every row it returns is one payslip line, one row per
 * (work day × band × class), settled under the component whose output is `line:label`. The funnel
 * has already moved the hours above the named limit to the funnel line at the band's own award,
 * so the incentive keeps the multiple of the band the hours came from.
 */
function measureWorkBands(options: {
	readonly work: Configuration['work'];
	readonly person: PersonContext;
	readonly days: readonly WorkBandDay[];
	readonly rates: {
		readonly ordinaryHour: number;
		readonly ordinaryDay: number;
		readonly dayWage: number;
	};
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly currency: string;
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
			person: options.person,
			day,
			rates: options.rates
		})) {
			const component = byOutput.get(`${row.line}:${row.label}`);
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
 * The monthly overtime ceiling is a funnel, not a refusal: regulated overtime beyond the cap in a
 * calendar month is paid as incentive at the band's own multiple, exactly as a day's hours past
 * the daily ceiling are. The cap counts the month's earlier paid runs first, so a window that
 * straddles two months continues each month from where the last run left it.
 */
export function funnelMonthlyOvertime(options: {
	readonly rows: readonly MeasuredAdjustment[];
	readonly days: readonly WorkBandDay[];
	readonly limits: Configuration['limits'];
	readonly prior: ReadonlyMap<string, number>;
	readonly catalogueComponents: readonly CatalogueComponent[];
	readonly currency: string;
}): { readonly rows: MeasuredAdjustment[]; readonly funnelledHours: ReadonlyMap<string, number> } {
	const limit = options.limits.find(
		(candidate) => candidate.period === 'MONTH' && candidate.measure === 'OVERTIME_HOURS'
	);
	if (limit == null) return { rows: [...options.rows], funnelledHours: new Map() };
	const maxHours = decodeNumber(limit.max_hours);
	const dateOf = new Map(options.days.map((day) => [day.workDayId, day.date]));
	const incentiveFor = (label: string) => {
		const component = options.catalogueComponents.find(
			(row) => row.family === 'WORK' && row.output === `${INCENTIVE_LINE}:${label}`
		);
		if (component == null)
			throw new Error(
				`The monthly overtime ceiling funnels ${label} hours to ${INCENTIVE_LINE} ${label}, which has no pay item to settle under.`
			);
		return component;
	};
	const running = new Map<string, number>();
	const funnelled = new Map<string, number>();
	const rows: MeasuredAdjustment[] = [];
	const ordered = options.rows
		.map((row, index) => ({ row, index, date: dateOf.get(row.input.id) ?? '' }))
		.toSorted((left, right) => left.date.localeCompare(right.date) || left.index - right.index);
	for (const { row, date } of ordered) {
		const overtime =
			row.input.family === 'WORK_DAY' &&
			row.catalogueComponent.output?.startsWith(`${OVERTIME_LINE}:`) === true &&
			row.quantity != null &&
			row.quantity > 0 &&
			date !== '';
		if (!overtime) {
			rows.push(row);
			continue;
		}
		const month = monthKey(date);
		const before = running.get(month) ?? options.prior.get(month) ?? 0;
		const hours = row.quantity!;
		const excess = Math.min(hours, Math.max(0, before + hours - maxHours));
		running.set(month, before + hours);
		if (excess <= 0) {
			rows.push(row);
			continue;
		}
		funnelled.set(month, (funnelled.get(month) ?? 0) + excess);
		const incentive = incentiveFor(row.label);
		const excessAmount = cents((row.amount * excess) / hours, options.currency);
		if (hours - excess > 0)
			rows.push({
				...row,
				quantity: hours - excess,
				amount: cents(row.amount - excessAmount, options.currency)
			});
		rows.push({
			...row,
			catalogueComponent: incentive,
			bucket: settlementBucket(incentive.destination, incentive.direction),
			quantity: excess,
			amount: excessAmount,
			statutoryRuleKey: `${INCENTIVE_LINE}:${row.label}`
		});
	}
	return { rows, funnelledHours: funnelled };
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
 * A quarter or a year is counted to date: what earlier payslips of this person settled for
 * the same months, plus this run.
 */
export function validateWorkResult(options: {
	readonly configuration: Configuration;
	readonly measured: MeasuredEmployment;
	/** Regulated overtime hours earlier payslips settled, by calendar month. */
	readonly priorOvertimeHours?: ReadonlyMap<string, number>;
}): RunIssue[] {
	const { configuration, measured } = options;
	const { bundle } = measured;
	const issues: RunIssue[] = validateOvertimeLimits({
		configuration: { ...configuration, limits: measured.limits },
		employeeNumber: bundle.employment.employee_number,
		hoursByMonth: measured.calendarMonthOvertimeHours,
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
	for (const limit of measured.limits) {
		if (limit.period !== 'DAY') continue;
		if (limit.measure === 'TOTAL_WORK_HOURS')
			issues.push(
				...validateDailyWorkLimit({
					employeeNumber: bundle.employment.employee_number,
					days: ownDays,
					maxWorkHours: limit.max_hours,
					unit: limit.unit
				})
			);
		if (limit.measure === 'OVERTIME_HOURS')
			issues.push(
				...validateDailyOvertimeHoursLimit({
					employeeNumber: bundle.employment.employee_number,
					days: ownDays,
					maxOvertimeHours: limit.max_hours
				})
			);
	}
	return issues;
}
