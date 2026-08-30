/**
 * Step 4 — MEASURE.
 *
 * Every plane of input — a contract, an entry, a clock, a formula — arrives here and leaves as
 * money. Components are measured in `pay_components.sequence` order, so the hourly rate exists
 * before overtime needs it and every earning exists before the grid sums them.
 *
 * ## Three shapes out, not one list
 *
 * A payslip comprises four things and the kind of each is DERIVED from what caused it, so MEASURE
 * emits them separately rather than emitting one flat list somebody later has to sort:
 *
 * ```
 *   base         employment_terms x period            caused by no record       inlined on payslips
 *   proration    what the calendar did to base        caused by no record       inlined on payslips
 *   adjustment   caused by exactly ONE input          names that input          payslip_adjustments
 * ```
 *
 * STATUTORY is the fourth and is not measured here: it is charged on the sum of the other two by
 * ACCUMULATE and CONTRIBUTE, which is why it is caused by no record either.
 *
 * **Proration is no longer folded into base.** The old shape summed a mid-month salary change into
 * one line and discarded the working; each segment is recorded here, with the terms row that
 * covered it, the days, the divisor and the basis, so a payslip stays re-readable after a
 * jurisdiction changes how it prorates.
 *
 * Two rules hold throughout:
 *
 * - **an amount is a magnitude.** Direction is the pay component's `nature` and the treatment's
 *   decision; no amount here carries a minus sign, including unpaid absence, whose type is
 *   `ABSENCE` and whose grid row is `REDUCE`.
 * - **an ineligible component produces nothing at all.** Not a zero, nothing. A manager has no
 *   overtime row, rather than an overtime row of zero. A source the run READ and priced at nothing
 *   is still captured — as a junction row, not as a zero-amount adjustment — because "consumed
 *   nothing" and "was never read" are different claims.
 *
 * `INFORMATION` components are measured, because later formulas read them, but they are not written
 * to the payslip: they are not money, the grid does not apply to them, and a report that sums a
 * column must never find an hourly rate inside it (plan 03 §2).
 */

import type { MoneyValue } from '@norbital-ai/std/finance';
import type { Configuration, OvertimeCoverageRule, PayComponent } from './configuration.js';
import type { ComponentDefinition } from '../../../datatypes/component_definition/+definition.js';
import {
	classifyWageComparand,
	decideOvertimeCoverage,
	deriveStatutoryWages,
	type WageBasis
} from './coverage.js';
import type { PayslipBase } from '../../../datatypes/payslip_base/+definition.js';
import type { PayslipProration } from '../../../datatypes/payslip_proration/+definition.js';
import {
	depletes,
	entryEvent,
	entryEventDate,
	entryPayPeriod,
	entrySign,
	prorates,
	recurringRange,
	repaymentOutstanding,
	type ComponentEntry,
	type LoanRepayment
} from './entries.js';
import {
	entryOverConsumedMessage,
	overConsumesEntry,
	overRecoversRepayment,
	repaymentOverRecoveredMessage
} from '../../../lib/settlement_refusals.js';
import {
	addDays,
	dateKey,
	daysBetween,
	inclusiveDays,
	intersectDays,
	monthBounds,
	monthDays,
	monthKey,
	requiredDateKey,
	type IsoDate
} from './dates.js';
import { clipRange, coversDate } from './effective.js';
import { isEligible, type EligibilitySubject } from './eligibility.js';
import { defaultPayPeriod, type PayrollWindow } from './period.js';
import { evaluateFormula, type FormulaContext } from './formula.js';
import type { EmploymentBundle } from './gather.js';
import {
	leaveBalance,
	leaveYearOf,
	resolveEntitlement,
	unpaidLeaveDates,
	unpaidLeaveInWindow,
	type UnpaidLeave
} from './leave.js';
import {
	extendedAbsenceDays,
	overtimeAttendanceWindow,
	type SettlementPolicy
} from './settlement.js';
import {
	classifyOvertimeByCalendarMonth,
	deriveDailyOvertime,
	philippineNightWorkHours,
	overtimeBandCode,
	priceDay,
	type DailyOvertime,
	type ExcessHours,
	type OvertimeBandIdentity,
	type PricedSegment
} from './overtime.js';
import {
	absenceDayRate,
	ordinaryDayWage,
	overtimeHourlyRate,
	readOvertimeCalculationMethod,
	type OvertimeCalculationMethod,
	type RateTerms
} from './ordinary-rate.js';
import { prorationFraction, prorationSegment } from './proration.js';
import { cents } from './rounding.js';
import { normalDailyHours, resolveSchedule, type ScheduledDay } from './schedule.js';
import { settle } from './settle.js';
import { patternWorkload, type PatternWorkload } from '../../../lib/scheduling/work-pattern.js';
import { rosterCodeKind, workWindow } from '../../../lib/scheduling/roster-code.js';

/** The economic direction a line settles in — `pay_components.policy.kind` where there is one. */
type LineNature = NonNullable<PayComponent['policy']>['kind'];

/**
 * What a measured amount looks like to the steps that price the whole payslip.
 *
 * ACCUMULATE and SETTLE ask three questions of every amount — what it settles as, which catalogue
 * row (if any) it pays, and whether the statute derived it — and those questions are the same for a
 * contracted amount and for one an input caused. They are asked of this shape, which both planes
 * satisfy structurally, so neither step reshapes anything on the way in.
 */
export type PricedItem = {
	/** The catalogue row this pays, or `null` for an amount the statute derived. */
	readonly payComponent: PayComponent | null;
	/**
	 * What the amount settles as, carried rather than read back off the component, because derived
	 * overtime has none to read it from. It is always an `EARNING`.
	 */
	readonly nature: LineNature | null;
	/** What to call this in an engine message — a component code, or the rule key that priced it. */
	readonly label: string;
	/** Always a magnitude. */
	readonly amount: number;
};

/**
 * One contracted amount, before any input touched it.
 *
 * BASE is `employment_terms x period`: it points at nothing, which is why it is inlined on
 * `payslips` rather than being a row in `payslip_adjustments`. A formula over the contract is base
 * for the same reason — nobody can edit a record that caused it, because no such record exists.
 */
export type MeasuredBase = PricedItem & {
	readonly payComponent: PayComponent;
	/** The stored shape, produced here so nothing downstream has to assemble it. */
	readonly entry: PayslipBase;
};

/**
 * The one input that caused an adjustment, in the shape `payslip_adjustments.input` is written in.
 *
 * MEASURE speaks of the four input **families** — the business sources themselves; GRAPH maps each
 * family onto the junction collection that stores the capture and the adjustment row the engine
 * emits carries the reference the database enforces. Keeping the family here and the junction
 * handle in GRAPH is what lets MEASURE stay pure: it decides which source caused what, and the
 * id minting and the junction writing happen once, beside them.
 */
type InputFamily = 'WORK_DAY' | 'COMPONENT_ENTRY' | 'LEAVE_REQUEST' | 'LOAN_REPAYMENT';

/** One source the run read, spelled in the four input families the payslip stores. */
type MeasuredInput = {
	readonly family: InputFamily;
	readonly id: string;
};

/**
 * One thing an input caused, in the shape `payslip_adjustments` stores.
 *
 * The adjustment names its causal input by family and source id; GRAPH resolves that to the
 * captured input link the junction row it is about to write will carry, because the junction row —
 * not the source record — is the thing `payslip_adjustments.input` points at. There are no
 * zero-amount settlement locks here any more: a source the run read and priced at nothing is a
 * junction row with no adjustment beside it, because an output that settles to nothing is no output
 * at all, and the capture is what locks the source.
 */
export type MeasuredAdjustment = PricedItem & {
	/** The one input that caused this row, by family and source id. */
	readonly input: MeasuredInput;
	/** The stable key of the statutory rule that priced a work-day input. Null on every other row. */
	readonly statutoryRuleKey: string | null;
	readonly quantity: number | null;
	readonly rate: number | null;
};

/** The captured inputs of one employment's payslip, before the junction ids exist. */
type CapturedInputs = {
	readonly workDays: readonly string[];
	readonly componentEntries: readonly string[];
	readonly leaveRequests: readonly string[];
	readonly loanRepayments: readonly string[];
};

export type MeasuredEmployment = {
	readonly bundle: EmploymentBundle;
	/** The contracted amounts. One entry per pay component, never one per terms row. */
	readonly base: readonly MeasuredBase[];
	/**
	 * What the calendar did to the contracted wage, one entry per segment.
	 *
	 * These are evidence rather than money: they are the working behind a `base` amount the calendar
	 * split, and their `prorated_amount` sums to it. Proration is no longer folded silently into
	 * base — a mid-month salary change is two segments here and one base entry, so the halves are
	 * readable years later against a proration basis that may since have changed.
	 */
	readonly proration: readonly PayslipProration[];
	/** One entry per thing exactly one input caused, where that input produced money. */
	readonly adjustments: readonly MeasuredAdjustment[];
	/** The four input families the run captured — including every zero-value source. */
	readonly captured: CapturedInputs;
	/** What a deferred earlier period is owed, when this run is the one paying it. */
	readonly arrears: {
		readonly period: string;
		readonly payComponentId: string;
		readonly amount: number;
	} | null;
	/** Amounts of every component measured, including `INFORMATION` — what formulas read. */
	readonly componentAmounts: ReadonlyMap<string, number>;
	readonly ordinaryHourlyRate: number;
	readonly ordinaryDayWage: number;
	readonly overtimeDays: readonly DailyOvertime[];
	/** Regulated ordinary/off-day OT by calendar month; rest days and PH are excluded. */
	readonly calendarMonthOvertimeHours: ReadonlyMap<string, number>;
	readonly currency: string;
	readonly schedule: ReadonlyMap<IsoDate, ScheduledDay>;
};

/**
 * The total-work-hours boundary past which overtime is reclassified as excess.
 *
 * It is the jurisdiction's own ceiling — Malaysia's twelve hours under EA 1955 s.60A(7) — and not a
 * number a company configures. It used to be read off the `after_total_work_hours` field of the
 * overflow pay components, which meant a company could quietly move a statutory boundary, and two
 * of them in the same country could disagree about where it sits.
 */
export function dailyTotalWorkLimit(configuration: Configuration): number | null {
	const limits = configuration.overtimeLimits.filter(
		(limit) => limit.period === 'DAY' && limit.measures === 'TOTAL_WORK_HOURS'
	);
	if (limits.length > 1)
		throw new Error('More than one daily work limit is effective for this jurisdiction.');
	return limits[0] == null ? null : Number(limits[0].max_hours);
}

function monthlyOvertimeLimit(configuration: Configuration): number | null {
	const limits = configuration.overtimeLimits.filter(
		(limit) => limit.period === 'MONTH' && limit.measures === 'OVERTIME_HOURS'
	);
	if (limits.length > 1)
		throw new Error('More than one monthly overtime limit is effective for this jurisdiction.');
	return limits[0] == null ? null : Number(limits[0].max_hours);
}

/** Everything `isStatutoryOvertimePayCovered` tests: the jurisdiction's rule and one employment's facts. */
type StatutoryOvertimeCoverageOptions = {
	readonly rule: OvertimeCoverageRule | null;
	readonly jurisdictionCode: string;
	readonly wages: Partial<Record<WageBasis, MoneyValue>>;
	readonly statutoryWorkCategory: string | null;
	readonly workClassification: string | null;
	readonly employeeNumber: string;
};

/**
 * Statutory OT / rest-day / holiday pay coverage, from the jurisdiction's own cited rule.
 *
 * The wage figures are passed in by basis, each filed under the basis it genuinely is. The caller
 * can produce both: `BASE_SALARY` from the employment terms, and `STATUTORY_WAGES` derived per
 * Employment Act 1955 s.2 as narrowed by First Schedule para 3 — basic plus every other cash
 * payment for work done, less overtime pay — from the pay components and their entries settling
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
	const authority = options.rule?.authority ?? 'the effective coverage rule';
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

function termsAt(bundle: EmploymentBundle, date: IsoDate): EmploymentBundle['terms'][number] {
	const row = bundle.terms.find((candidate) => coversDate(candidate.effective_range, date));
	if (!row)
		throw new Error(
			`${bundle.employment.employee_number} has no employment terms effective on ${date}. ` +
				'Every day of the period a person is paid for must be covered by terms.'
		);
	return row;
}

const PAY_FREQUENCIES = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'] as const;

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
	if (workDays === 0 || paidMinutes === 0)
		throw new Error(
			'An AS_ASSIGNED employment has no assigned WORK days in the payroll reference window, so ' +
				'ordinary weekly and daily hours cannot be derived.'
		);
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
	const workload = patternWorkload(options.terms.work_pattern, options.configuration.shiftById);
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
	const workingDaysPerWeek = (workload.work_days * 7) / workload.reference_days;
	return {
		base_salary: { value: Number(salary.value), currency: salary.currency },
		pay_frequency: payFrequency(terms.pay_frequency),
		ordinary_hours_per_week: workload.average_weekly_paid_minutes / 60,
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
	const start = String(terms.effective_range?.start ?? '').slice(0, 10);
	const title =
		terms.job_title == null || terms.job_title === '' ? terms.employment_type : terms.job_title;
	return `${title} @ ${start} · ${Number(terms.base_salary?.value ?? 0).toFixed(2)}`;
}

/** The window-shaped arguments `measureEmployment` hands its helpers. */
type PayRange = PayrollWindow['salary'];

/** Measure one employment's whole payslip. */
type MeasureEmploymentOptions = {
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly period: string;
	readonly salary: PayRange;
	readonly periodsRemaining: number;
	readonly headcount: number;
	readonly policy: SettlementPolicy;
	/** `component_entry_id` → what earlier PAID runs already took from it. See `gather.ts`. */
	readonly consumedEntries: ReadonlyMap<string, number>;
	/** `loan_repayment_id` → what earlier PAID runs already recovered from it. See `gather.ts`. */
	readonly consumedRepayments: ReadonlyMap<string, number>;
};

export function measureEmployment(options: MeasureEmploymentOptions): MeasuredEmployment {
	const { bundle, configuration } = options;
	// The attendance window is the employment's, not the run's: a leaver settling in their final
	// period is measured to the exit date, because no later run will ever read those days.
	const attendance = bundle.attendance;
	const employed = bundle.employedDays;
	if (employed == null)
		throw new Error(
			`${bundle.employment.employee_number} is not employed during ${options.period}.`
		);
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
	const overtimeCalculationMethod = readOvertimeCalculationMethod(
		configuration.company.overtime_calculation_method
	);
	const hourlyRate = overtimeHourlyRate(
		rateTerms,
		configuration.jurisdiction,
		overtimeCalculationMethod
	);
	const dayWage = ordinaryDayWage(rateTerms, configuration.jurisdiction);

	// ── schedule across the full calendar months touched by the settlement cutoff ───────────────
	const complianceWindow: PayRange = {
		start: monthBounds(monthKey(attendance.start)).start,
		end: monthBounds(monthKey(attendance.end)).end
	};
	const attendanceDays = daysBetween(complianceWindow.start, complianceWindow.end);
	const scheduleTermsAt = (date: IsoDate) => {
		// Attendance can run before the pay period starts, so a day outside the terms history falls
		// back to the closest terms row rather than blocking a run on a boundary day.
		const row =
			bundle.terms.find((candidate) => coversDate(candidate.effective_range, date)) ??
			bundle.terms[0] ??
			closingTerms;
		const workload = termsWorkload({
			terms: row,
			configuration,
			workDays: bundle.workDays,
			window: complianceWindow
		});
		return {
			work_pattern: row.work_pattern,
			normal_daily_hours: workload.paid_minutes / workload.work_days / 60
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
	const takenLeaveDates = new Set<IsoDate>();
	for (const row of bundle.ledger) {
		if (row.kind !== 'TAKEN' || row.approval_id != null) continue;
		const date = dateKey(row.entry_date);
		if (date != null) takenLeaveDates.add(date);
	}
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
	 * `ordinary_day_wage` divides by `ordinary_rate_divisor` — 26 in Malaysia, EA s.60I — because that
	 * is the basis the Act sets for what an extra day of work is worth. Withholding pay for a day not
	 * worked is proration, and proration is `jurisdictions.proration`: the month's calendar days here,
	 * working days elsewhere. Valuing an absence at the overtime divisor over-deducts by the ratio
	 * between them — 31/26, about 19%, on every employee with unpaid leave.
	 *
	 * Rounded to the cent before it is multiplied by the day count, not after, which is what the
	 * source system does and what reproduces its figures exactly.
	 */
	const absenceDayWage = absenceDayRate({
		terms: rateTerms,
		jurisdiction: {
			...configuration.jurisdiction,
			proration:
				options.policy.absenceProration.find(
					(rule) => rule.payFrequency === rateTerms.pay_frequency
				)?.basis ?? configuration.jurisdiction.proration
		},
		period: options.salary,
		workingDaysIn
	});

	// ── component entries and loan repayments settling in this run ─────────────────────────────
	//
	// Collected before the coverage test because the test reads them: the wage the ceiling is
	// measured against is basic plus the cash-for-work entries settling here, so the set is fixed
	// before anyone asks who the ladder covers.
	//
	// Loan repayments are not in here. They are recovered against their own due dates below, against
	// what earlier paid runs already recovered — the junction rows the prior runs captured are read
	// back in `gather.ts`, and nothing is carried forward between builds.
	const cutoffDay = Number(configuration.company.pay_cutoff_day);
	const ownedArrears = (entry: ComponentEntry): boolean => {
		const event = entryEvent(entry);
		return (
			bundle.arrearsFor != null &&
			entry.pay_component_id === options.policy.lateJoinerComponentId &&
			event?.kind === 'ARREARS' &&
			event.covers_periods.length === 1 &&
			event.covers_periods[0] === bundle.arrearsFor.period
		);
	};
	const periodEntries = bundle.componentEntries.filter((entry) => {
		if (ownedArrears(entry)) return false;
		const recurring = recurringRange(entry);
		if (recurring == null) return entryPayPeriod(entry, cutoffDay) === options.period;
		return (
			recurring.start <= options.salary.end &&
			(recurring.end == null || recurring.end >= options.salary.start)
		);
	});
	const entriesByComponent = new Map<string, ComponentEntry[]>();
	for (const entry of periodEntries) {
		const bucket = entriesByComponent.get(entry.pay_component_id);
		if (bucket) bucket.push(entry);
		else entriesByComponent.set(entry.pay_component_id, [entry]);
	}
	const entryTotalByComponentId = new Map<string, number>();
	for (const component of configuration.payComponents) {
		entryTotalByComponentId.set(
			component.id,
			(entriesByComponent.get(component.id) ?? []).reduce(
				(total, entry) => total + entrySign(entry) * Number(entry.amount),
				0
			)
		);
	}

	const subject = {
		employment_type: closingTerms.employment_type,
		work_classification: closingTerms.work_classification,
		service_months: bundle.serviceMonths,
		gender: bundle.employee.gender,
		department: closingTerms.department,
		payroll_group: closingTerms.payroll_group
	};

	// ── overtime, derived from clocks and split only beyond the total-work-hours boundary ───────
	//
	// `worked_intervals` is the presence test for the actual half of a work day: NULL means no
	// attendance was recorded at all, while an empty array means the day was read and nothing was
	// worked. Only the second is attendance, and only attendance can be priced or claimed — a day
	// carrying nothing but a plan has no clock to derive an hour from and no punch to freeze.
	const attendedDays = bundle.workDays.filter((day) => day.worked_intervals != null);
	const dailyWorkLimit = dailyTotalWorkLimit(configuration);
	const overtimeAttendance = overtimeAttendanceWindow({
		policy: options.policy,
		payFrequency: rateTerms.pay_frequency,
		salary: options.salary,
		fallback: attendance
	});
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
		const derived = deriveDailyOvertime(entry, day, configuration.restBreakRules);
		if (derived) overtimeDays.push(derived);
	}
	// The wage the ceiling is measured against is derived per Employment Act 1955 s.2 as narrowed by
	// First Schedule para 3 — basic plus every other cash payment for work done, less overtime pay —
	// from the employee's own components and entries. Only components this employment is eligible
	// for count: an allowance someone is not entitled to is not part of their wages.
	const statutoryWages = deriveStatutoryWages({
		baseSalary: rateTerms.base_salary,
		payments: configuration.payComponents
			.filter((component) => isEligible(component.eligibility, subject))
			.map((component) => ({
				category: classifyWageComparand(component),
				amount: entryTotalByComponentId.get(component.id) ?? 0
			}))
	});
	const paymentEligible = isStatutoryOvertimePayCovered({
		rule: configuration.overtimeCoverageRule,
		jurisdictionCode: configuration.jurisdiction.code,
		wages: {
			BASE_SALARY: rateTerms.base_salary,
			STATUTORY_WAGES: statutoryWages
		},
		statutoryWorkCategory: closingTerms.statutory_work_category,
		workClassification: closingTerms.work_classification,
		employeeNumber: bundle.employment.employee_number
	});
	const classifiedOvertime = classifyOvertimeByCalendarMonth({
		days: overtimeDays,
		dailyWorkLimit,
		monthlyOrdinaryOvertimeLimit: monthlyOvertimeLimit(configuration)
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

	// ── unpaid leave, in whichever window each day settles by ──────────────────────────────────
	//
	// A day inside a leave of absence settles in its own calendar month; every other unpaid day
	// settles in the run whose attendance window contains it. `extendedDates` is the whole set of
	// days the first rule applies to, computed from the employment's entire unpaid history so that
	// a spell straddling a month boundary is recognised as one absence from either side of it.
	const extendedRule = options.policy.extendedUnpaidLeave;
	const extendedDates =
		extendedRule == null || !bundle.extendedLeaveSettlesInOwnMonth
			? new Set<IsoDate>()
			: extendedAbsenceDays({
					dates: unpaidLeaveDates(bundle.ledger, configuration.leaveTypes),
					minimumCalendarDays: extendedRule.minimumCalendarDays,
					bridgedGapDays: extendedRule.bridgedGapDays
				});
	const settlesHere = (date: IsoDate): boolean =>
		extendedDates.has(date)
			? date >= options.salary.start && date <= options.salary.end
			: date >= attendance.start && date <= attendance.end;
	const unpaid = unpaidLeaveInWindow({
		ledger: bundle.ledger,
		window: attendance,
		month: options.salary,
		extendedDates,
		configuration
	});
	const unpaidByComponent = new Map<string, UnpaidLeave>(
		unpaid.map((row) => [row.componentId, row])
	);

	// ── the formula context, emitted complete: CEL throws on a missing key ─────────────────────
	const componentAmounts = new Map<string, number>();
	const componentsByCode: Record<string, number> = {};
	// `entry(CODE)` is the formula vocabulary and it is unchanged: an entry is what a person or HR
	// raised against a component this period, which is exactly what the word always meant.
	const entryTotals: Record<string, number> = {};
	for (const component of configuration.payComponents) {
		componentsByCode[component.code] = 0;
		entryTotals[component.code] = entryTotalByComponentId.get(component.id) ?? 0;
	}
	const facts: Record<string, string | number | boolean> = {};
	for (const contribution of configuration.contributions) {
		const fact = bundle.statutoryFacts.find(
			(row) =>
				row.statutory_contribution_id === contribution.row.id &&
				coversDate(row.effective_range, options.salary.end)
		);
		const status = fact?.status;
		// An absent row means registered with nothing captured, so the default is registration.
		facts[`${contribution.row.code}.registered`] = status == null || status.kind === 'REGISTERED';
		facts[`${contribution.row.code}.reference_number`] =
			status != null && status.kind === 'REGISTERED' ? status.reference_number : '';
		facts[`${contribution.row.code}.rate_override`] =
			status != null && status.kind === 'REGISTERED' && status.rate_override != null
				? status.rate_override
				: -1;
		facts[`${contribution.row.code}.reason`] =
			status != null && status.kind === 'NOT_REGISTERED' ? status.reason : '';
	}
	const leaveDays: Record<string, number> = {};
	const leaveBalances: Record<string, number> = {};
	const hireDate = dateKey(bundle.employment.hire_date) ?? options.salary.start;
	const exitDate = dateKey(bundle.employment.exit_date);
	for (const type of configuration.leaveTypes) {
		leaveDays[type.code] = bundle.ledger
			.filter(
				(row) => row.leave_type_id === type.id && row.kind === 'TAKEN' && row.approval_id == null
			)
			// The same predicate the deduction itself uses. An unpaid-absence component is a FORMULA
			// over `leaveDays(...)`, so if this counted a different set of days than
			// `unpaidLeaveInWindow` selected, the money and the day count on the same payslip line
			// would disagree — and the quantity would be the one nobody checks.
			.reduce((total, row) => {
				const date = String(row.entry_date).slice(0, 10);
				return settlesHere(date) ? total + Math.abs(Number(row.days)) : total;
			}, 0);
		// The settled balance, derived in full — carried in, accrued, expired, plus the ledger.
		// Payroll never acts on it, but a formula may read it (an encashment on exit does), and it
		// is emitted for every type so CEL never meets a missing key.
		leaveBalances[type.code] = leaveBalance(
			{
				leaveType: type,
				entitlementAt: (serviceMonths, asOf) =>
					resolveEntitlement({
						leaveType: type,
						profile: configuration.jurisdiction,
						children: bundle.children,
						serviceMonths,
						employmentId: bundle.employment.id,
						asOf
					}),
				hireDate,
				exitDate,
				leaveYearStartMonth: Number(configuration.company.leave_year_start_month),
				ledger: bundle.ledger,
				basis: 'SETTLED'
			},
			options.salary.end
		);
	}
	const periodCalendarDays = monthDays(options.salary.start);
	const nightShiftHours =
		configuration.jurisdiction.code === 'PH'
			? attendedDays
					.filter((entry) => {
						const date = requiredDateKey(entry.work_date, 'work_days.work_date');
						return date >= overtimeAttendance.start && date <= overtimeAttendance.end;
					})
					.reduce((total, entry) => total + philippineNightWorkHours(entry), 0)
			: 0;
	const context = (): FormulaContext => ({
		components: componentsByCode,
		entries: entryTotals,
		facts,
		leaveDays,
		leaveBalances,
		terms: {
			base_salary: rateTerms.base_salary.value,
			currency,
			pay_frequency: rateTerms.pay_frequency,
			ordinary_hours_per_week: rateTerms.ordinary_hours_per_week,
			working_days_per_week: rateTerms.working_days_per_week,
			// Emitted as empty strings rather than omitted: CEL has no `?.` and throws on a missing key.
			work_classification: closingTerms.work_classification ?? '',
			employment_type: closingTerms.employment_type ?? '',
			rest_day: ''
		},
		derived: {
			service_months: bundle.serviceMonths,
			age: bundle.age ?? -1,
			employed_days: inclusiveDays(employed.start, employed.end),
			headcount: options.headcount,
			ordinary_hourly_rate: hourlyRate,
			normal_daily_hours: normalDailyHours(rateTerms),
			night_shift_hours: nightShiftHours,
			ordinary_day_wage: dayWage,
			absence_day_wage: absenceDayWage
		},
		period: {
			start: options.salary.start,
			end: options.salary.end,
			calendar_days: periodCalendarDays,
			working_days: workingDaysIn(options.salary),
			periods_remaining: options.periodsRemaining,
			pay_fraction: prorationFraction({
				jurisdiction: configuration.jurisdiction,
				period: options.salary,
				covered: wageDays,
				workingDaysIn
			})
		},
		jurisdiction: {
			code: configuration.jurisdiction.code,
			currency: configuration.jurisdiction.currency,
			ordinary_rate_basis: configuration.jurisdiction.ordinary_rate_basis ?? '',
			ordinary_rate_divisor: Number(configuration.jurisdiction.ordinary_rate_divisor)
		}
	});

	// ── what a deferred earlier period owes, measured the same way it would have been paid ──────
	//
	// The arrears is **this same function**, run against the deferred period's own windows. That is
	// what makes the figure "what that month would have paid" rather than a second, parallel
	// calculation of it — a prorated wage, its recurring allowances and the entries that settled
	// there, all under the terms and the law in force then. Nothing carries across from the earlier
	// run, because there may not have been one.
	//
	// The recursion is one level deep by construction: the derived bundle owes nothing itself.
	const calculatedArrears = measureArrears(options);
	// A source payroll instruction can state the same late-joiner back pay that the settlement
	// policy is able to derive. The source entry is authoritative evidence and already produces
	// a fully linked adjustment below; adding the identical derived amount would pay it twice and
	// leave that duplicate with no record to point at. Only suppress the derived copy when the
	// current period contains an exact same-component, same-amount entry.
	const explicitArrears =
		calculatedArrears == null
			? undefined
			: (entriesByComponent.get(calculatedArrears.payComponentId) ?? []).find(
					(entry) => cents(entrySign(entry) * Number(entry.amount)) === calculatedArrears.amount
				);
	const arrears = explicitArrears == null ? calculatedArrears : null;

	// ── walk the catalogue in component sequence ───────────────────────────────────────────────
	const base: MeasuredBase[] = [];
	const proration: PayslipProration[] = [];
	const adjustments: MeasuredAdjustment[] = [];
	if (arrears != null) {
		const component = configuration.payComponents.find((row) => row.id === arrears.payComponentId);
		if (component == null)
			throw new Error(
				`${bundle.employment.employee_number} is owed ${arrears.period}, but the component it is ` +
					'paid back on is not in this company’s catalogue.'
			);
		// Derived back pay points at nothing a person can edit — the settlement policy and the earlier
		// month's own contract produced it — so it is base, exactly like the wage it stands in for.
		base.push({
			payComponent: component,
			nature: component.policy?.kind ?? null,
			label: component.code,
			amount: arrears.amount,
			entry: { component_code: component.code, amount: arrears.amount }
		});
		componentAmounts.set(component.code, arrears.amount);
		componentsByCode[component.code] = arrears.amount;
	}
	for (const component of configuration.payComponents) {
		if (!isEligible(component.eligibility, subject)) continue;
		const componentEntries = entriesByComponent.get(component.id) ?? [];
		// One entry, one measurement, because one adjustment row names one captured input. Everything
		// else measures once for the component: a schedule and a formula have no entry at all.
		const groups: readonly (ComponentEntry | null)[] =
			component.definition?.source === 'ENTRY' ? componentEntries : [null];
		for (const entry of groups) {
			const measured = measureComponent({
				component,
				bundle,
				configuration,
				salary: options.salary,
				employed: wageDays,
				contracted: employed,
				entry,
				consumedEntries: options.consumedEntries,
				period: options.period,
				unpaid: unpaidByComponent.get(component.id) ?? null,
				workingDaysIn,
				context,
				subject
			});
			if (measured == null) continue;
			// `+`, not `=`: a back-pay component can carry both this run's derived arrears and an
			// entry HR keyed by hand, and a formula reading that code must see the whole of it.
			const running = (componentAmounts.get(component.code) ?? 0) + measured.amount;
			componentAmounts.set(component.code, running);
			componentsByCode[component.code] = running;
			// Information is measured so formulas can read it, and stops there: it is not money.
			if (component.nature === 'INFORMATION') continue;
			base.push(...measured.base);
			proration.push(...measured.proration);
			adjustments.push(...measured.adjustments);
		}
	}
	// Overtime is not in the catalogue, so it is not produced by walking it. The priced segments
	// *are* the overtime: each one already names the statutory rule key that valued it and the work
	// day whose clock it came from, and an adjustment is one band's worth of them **on one day**.
	adjustments.push(
		...measureOvertime({
			segments,
			excess,
			hourlyRate,
			dayWage,
			overtimeCalculationMethod
		})
	);

	const repaymentRecoveries = measureLoanRecoveries({
		bundle,
		configuration,
		period: options.period,
		cutoffDay,
		subject,
		consumedRepayments: options.consumedRepayments
	});
	for (const recovery of repaymentRecoveries) {
		const running = (componentAmounts.get(recovery.label) ?? 0) + recovery.amount;
		componentAmounts.set(recovery.label, running);
		componentsByCode[recovery.label] = running;
		adjustments.push(recovery);
	}

	/**
	 * The captured inputs, as the four families the payslip's `inputs` attribute stores.
	 *
	 * The junctions ARE the settlement lock now: every source the run READ is a junction row, whether
	 * or not it produced money — "consumed nothing" and "was never read" are different claims, and
	 * only the first is a capture. The lock query targets these junction rows, never the adjustments,
	 * because an input that prices to zero has an output of nothing and still holds its claim.
	 *
	 * The span is the union of the attendance window and the wage window, because both are consumed —
	 * attendance prices the days worked, and the wage window is what recurring salary covers. The
	 * band GATHER reads is wider than the run prices — both calendar months the cutoff touches, so
	 * the monthly statutory overtime counter can reset — and those extra days belong to a
	 * neighbouring period. Capturing them would freeze attendance a future run has not settled yet.
	 */
	const lockSpan = {
		start: wageDays.start < attendance.start ? wageDays.start : attendance.start,
		end: wageDays.end > attendance.end ? wageDays.end : attendance.end
	};
	const capturedWorkDayIds = [
		...new Set([
			...adjustments.filter((row) => row.input.family === 'WORK_DAY').map((row) => row.input.id),
			...attendedDays.flatMap((day) => {
				const date = requiredDateKey(day.work_date, 'work_days.work_date');
				return date >= lockSpan.start && date <= lockSpan.end ? [day.id] : [];
			})
		])
	];
	const capturedLeaveRequestIds = new Set<string>(
		adjustments.filter((row) => row.input.family === 'LEAVE_REQUEST').map((row) => row.input.id)
	);
	// One pass over the ledger: the span filter and the id projection are one loop, and the
	// same-set deduplication is the set itself.
	for (const movement of bundle.ledger) {
		const date = dateKey(movement.entry_date);
		if (date == null || date < lockSpan.start || date > lockSpan.end) continue;
		capturedLeaveRequestIds.add(movement.id);
	}

	return {
		bundle,
		base,
		proration,
		adjustments,
		captured: {
			workDays: capturedWorkDayIds,
			componentEntries: periodEntries.map((entry) => entry.id),
			leaveRequests: [...capturedLeaveRequestIds],
			loanRepayments: repaymentRecoveries.map((recovery) => recovery.input.id)
		},
		arrears,
		componentAmounts,
		ordinaryHourlyRate: hourlyRate,
		ordinaryDayWage: dayWage,
		overtimeDays,
		calendarMonthOvertimeHours,
		currency,
		schedule
	};
}

/**
 * What the deferred period would have paid, measured by measuring it.
 *
 * The bundle is rebuilt against the earlier month — its own employed days, its own attendance
 * window, and only the entries and clocks that fall inside it — and then handed back to
 * `measureEmployment`. The number that comes out is that month's gross: prorated wage, standing
 * allowances, whatever settled there, less anything unpaid. It is the same arithmetic the person
 * would have seen on a payslip, which is the only defensible definition of what they are owed.
 */
function measureArrears(
	options: Pick<
		MeasureEmploymentOptions,
		| 'bundle'
		| 'configuration'
		| 'periodsRemaining'
		| 'headcount'
		| 'policy'
		| 'consumedEntries'
		| 'consumedRepayments'
	>
): MeasuredEmployment['arrears'] {
	const owed = options.bundle.arrearsFor;
	const payComponentId = options.policy.lateJoinerComponentId;
	if (owed == null || payComponentId == null) return null;
	const measured = measureEmployment({
		bundle: {
			...options.bundle,
			// One list now, plan and punch on the same row, so one filter covers both halves.
			workDays: options.bundle.workDays.filter((row) => {
				const date = requiredDateKey(row.work_date, 'work_days.work_date');
				return date >= owed.attendance.start && date <= owed.attendance.end;
			}),
			employedDays: owed.days,
			wageDays: owed.days,
			attendance: owed.attendance,
			arrearsFor: null,
			deferral: null
		},
		configuration: options.configuration,
		period: owed.period,
		salary: owed.salary,
		periodsRemaining: options.periodsRemaining,
		headcount: options.headcount,
		policy: options.policy,
		// Carried through rather than emptied, so the deferred pass sees the same consumption facts
		// this one does. Its deductions are discarded either way — only `gross` is read below — but a
		// second, differently-informed view of the same sources is the kind of thing that is true
		// until somebody reads more than gross out of it.
		consumedEntries: options.consumedEntries,
		consumedRepayments: options.consumedRepayments
	});
	// The deferred period's **gross**, by SETTLE's own definition of it and not a second one. What is
	// owed for a month is what that month's payslip would have said was earned; charging statutory
	// on it is this run's job, on this run's combined wage, which is what the source system does.
	const amount = settle({
		base: measured.base,
		adjustments: measured.adjustments,
		charges: []
	}).gross;
	return amount <= 0 ? null : { period: owed.period, payComponentId, amount };
}

/**
 * Recovery of a loan repayment, from its own due date and from nothing else.
 *
 * The loan is the agreement; the repayment is the input. Payroll consumes `loan_repayments` rows,
 * never the loan master, which is the whole of what the split buys: a repayment an earlier run
 * could not take in full is still owed, and this is where it is recovered — by re-deriving it from
 * what earlier paid runs actually took, rather than by a copy written into next month's records. A
 * repayment already recovered in full nets to zero here and produces nothing, so the widened window
 * costs a subtraction and never a double deduction.
 *
 * Each repayment belongs to the run `defaultPayPeriod(due_date, cutoff)` names, so a 21st cutoff is
 * honoured. **One adjustment per repayment**: `payslip_adjustments.input` names one captured input
 * link, and the junction's `unique(payslip_id, loan_repayment_id)` makes the per-repayment
 * granularity structural. That is also the granularity outstanding is defined at:
 * `amount_due − Σ(what earlier paid runs recovered)`, which is what makes a part-recovered
 * repayment catch up without any row being carried forward.
 */
/** What `measureRepaymentRecoveries` needs: the bundle, its catalogue and one run's cutoff facts. */
type MeasureRecoveryOptions = {
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly period: string;
	readonly cutoffDay: number;
	readonly subject: EligibilitySubject;
	readonly consumedRepayments: ReadonlyMap<string, number>;
};

function measureLoanRecoveries(options: MeasureRecoveryOptions): MeasuredAdjustment[] {
	const recoveries: MeasuredAdjustment[] = [];
	const componentById = new Map(
		options.configuration.payComponents.map((component) => [component.id, component])
	);
	const loanById = new Map(options.bundle.loans.map((loan) => [loan.id, loan]));
	// In `(due_date, sequence)` order, which is the plan's order and stable for the same rows;
	// nothing about the money depends on it, but a payslip whose row order moved between two
	// identical builds would look like a change.
	const dueRepayments = [...options.bundle.loanRepayments].toSorted(
		(left, right) =>
			String(left.due_date).localeCompare(String(right.due_date)) || left.sequence - right.sequence
	);
	for (const repayment of dueRepayments) {
		const component = componentById.get(loanById.get(repayment.loan_id)?.pay_component_id ?? '');
		if (component == null || component.nature !== 'DEDUCTION') continue;
		if (!isEligible(component.eligibility, options.subject)) continue;
		const due = dateKey(repayment.due_date) ?? String(repayment.due_date).slice(0, 10);
		/**
		 * Due by now, not due exactly now.
		 *
		 * A repayment an earlier run could not take in full is still owed, and this is where it is
		 * recovered — by re-deriving what is outstanding against what was actually recovered, rather
		 * than by a copy of it written into next month's schedule. A repayment already settled in
		 * full nets to zero here and produces nothing.
		 */
		if (defaultPayPeriod(due, options.cutoffDay) > options.period) continue;
		const consumed = options.consumedRepayments.get(repayment.id) ?? 0;
		const outstanding = repaymentOutstanding(repayment, consumed);
		if (outstanding <= 0) continue;
		const amount = cents(outstanding);
		assertWithinRepayment({
			repayment,
			dueDate: due,
			consumed,
			proposed: amount,
			period: options.period
		});
		recoveries.push({
			input: { family: 'LOAN_REPAYMENT', id: repayment.id },
			payComponent: component,
			nature: component.policy?.kind ?? null,
			label: component.code,
			amount,
			quantity: null,
			rate: null,
			statutoryRuleKey: null
		});
	}
	return recoveries;
}

/**
 * The cross-run ceilings, raised where the amount is derived.
 *
 * A repayment may legitimately be touched by several payslips — net-pay protection can part-recover
 * it — so the junction carries no global unique index, and the ceiling that keeps the sum of what
 * every paid run recovered inside the amount due is arithmetic. This is that arithmetic, and
 * `REPAYMENT_OVER_RECOVERED` is its name. The entry ceiling beside it is the defence-in-depth
 * statement of single use: a one-off entry belongs to at most one standing/paid payslip, which the
 * gather step refuses outright, so this check guards the shape rather than the practice.
 */
type RepaymentCeiling = Readonly<{
	readonly repayment: LoanRepayment;
	/** The due date as a calendar day, for the refusal's sentence. */
	readonly dueDate: string;
	readonly consumed: number;
	readonly proposed: number;
	readonly period: string;
}>;

function assertWithinRepayment(options: RepaymentCeiling): void {
	const consumption = {
		loan_repayment_id: options.repayment.id,
		due_date: options.dueDate,
		amount_due: Number(options.repayment.amount_due),
		consumed: options.consumed,
		proposed: options.proposed,
		period: options.period
	};
	if (overRecoversRepayment(consumption))
		throw new Error(repaymentOverRecoveredMessage(consumption));
}

/** What `assertWithinEntry` needs to raise the one-off entry's ceiling by name. */
type EntryCeiling = Readonly<{
	readonly entry: ComponentEntry;
	readonly componentCode: string;
	readonly consumed: number;
	readonly proposed: number;
	readonly period: string;
}>;

function assertWithinEntry(options: EntryCeiling): void {
	if (!depletes(options.entry)) return;
	const consumption = {
		component_entry_id: options.entry.id,
		component_code: options.componentCode,
		entitlement: Number(options.entry.amount),
		consumed: options.consumed,
		proposed: options.proposed,
		period: options.period
	};
	if (overConsumesEntry(consumption)) throw new Error(entryOverConsumedMessage(consumption));
}

/**
 * What one measured component produced, in the three shapes a payslip stores.
 *
 * `amount` is the total, and it is what the formula context reads back; the three arrays are where
 * that total is *recorded*, and which one it lands in is derived from what caused it rather than
 * declared on it. A contracted amount has no source and is `base`; the segments the calendar split
 * it into are `proration`; anything one editable record caused is an `adjustment` naming that
 * record.
 */
type Measurement = {
	readonly amount: number;
	readonly base: readonly MeasuredBase[];
	readonly proration: readonly PayslipProration[];
	readonly adjustments: readonly MeasuredAdjustment[];
};

type EntryCap = NonNullable<Extract<ComponentDefinition, { source: 'ENTRY' }>['cap']>;

/** What `resolveEntryCap` needs to read the cap and price what this run already used of it. */
type ResolveEntryCapOptions = {
	readonly cap: EntryCap;
	readonly component: PayComponent;
	readonly entry: ComponentEntry;
	readonly bundle: EmploymentBundle;
	readonly subject: EligibilitySubject;
	readonly context: FormulaContext;
	readonly leaveYearStartMonth: number;
};

function resolveEntryCap(
	options: ResolveEntryCapOptions
): { amount: number; percentage: number; exceededBy: number } | null {
	const eventDate = entryEventDate(options.entry);
	if (eventDate == null)
		throw new Error(`Component entry ${options.entry.id} has no event date to cap by.`);
	const applicable = options.cap.matrix.layers.flatMap((layer) => {
		if (layer.level === 'EMPLOYEE' && layer.employment_id !== options.bundle.employment.id)
			return [];
		if (
			!coversDate(layer.effective_range, eventDate) ||
			!isEligible(layer.eligibility, options.subject)
		)
			return [];
		const amount =
			layer.award.kind === 'FIXED'
				? layer.award.amount
				: evaluateFormula({
						code: `${options.component.code}_${layer.level}_ENTITLEMENT`,
						expr: layer.award.expr,
						context: options.context
					});
		return [{ level: layer.level, amount, percentage: layer.reimbursement_percentage }];
	});
	if (applicable.length === 0) return null;
	const amount = Math.max(...applicable.map((layer) => layer.amount));
	const percentage = Math.max(...applicable.map((layer) => layer.percentage));
	const samePeriod = (candidate: ComponentEntry): boolean => {
		const candidateDate = entryEventDate(candidate);
		if (candidateDate == null) return false;
		switch (options.cap.period) {
			case 'PER_EVENT':
				return false;
			case 'LIFETIME':
				return true;
			case 'MONTH':
				return candidateDate.slice(0, 7) === eventDate.slice(0, 7);
			case 'CALENDAR_YEAR':
				return candidateDate.slice(0, 4) === eventDate.slice(0, 4);
			case 'LEAVE_YEAR':
				return (
					leaveYearOf(candidateDate, options.leaveYearStartMonth) ===
					leaveYearOf(eventDate, options.leaveYearStartMonth)
				);
		}
	};
	const previouslyUsed = options.bundle.componentEntries.reduce((total, candidate) => {
		if (candidate.pay_component_id !== options.component.id || candidate.id === options.entry.id)
			return total;
		const candidateDate = entryEventDate(candidate);
		if (candidateDate == null) return total;
		if (
			!samePeriod(candidate) ||
			candidateDate > eventDate ||
			(candidateDate === eventDate && candidate.id > options.entry.id)
		)
			return total;
		return total + (entrySign(candidate) * Number(candidate.amount) * percentage) / 100;
	}, 0);
	return { amount, percentage, exceededBy: Math.max(0, previouslyUsed) };
}

type MeasureComponentOptions = {
	readonly component: PayComponent;
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly salary: PayRange;
	readonly employed: PayRange;
	readonly contracted: PayRange;
	/** The one component entry this call measures, or `null` for a component no entry feeds. */
	readonly entry: ComponentEntry | null;
	readonly consumedEntries: ReadonlyMap<string, number>;
	readonly period: string;
	readonly unpaid: UnpaidLeave | null;
	readonly workingDaysIn: (window: PayRange) => number;
	readonly context: () => FormulaContext;
	readonly subject: EligibilitySubject;
};

function measureComponent(options: MeasureComponentOptions): Measurement | null {
	const definition = options.component.definition;
	if (definition == null)
		throw new Error(`Pay component ${options.component.code} has no definition to measure.`);
	const nature = options.component.policy?.kind ?? null;

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
			covered: ReturnType<typeof clipRange>
		): void => {
			const segment = prorationSegment({
				jurisdiction: options.configuration.jurisdiction,
				period: options.salary,
				covered,
				workingDaysIn: options.workingDaysIn
			});
			if (segment == null || segment.denominator <= 0 || segment.days <= 0) return;
			const contract = Number(baseSalaryOf(terms).value);
			measured.push({
				segment,
				termKey: termsSnapshotKey(terms),
				contract,
				exact: contract * (segment.days / segment.denominator)
			});
		};
		for (const terms of options.bundle.terms)
			record(terms, clipRange(terms.effective_range, options.contracted));
		// A full-final-period policy extends the last effective wage through month end. The
		// contract row still ends on the real exit date; only this run's settlement span extends.
		if (options.employed.end > options.contracted.end)
			record(termsAt(options.bundle, options.contracted.end), {
				start: addDays(options.contracted.end, 1),
				end: options.employed.end
			});
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
			base: [
				{
					payComponent: options.component,
					nature,
					label: options.component.code,
					amount,
					entry: { component_code: options.component.code, amount }
				}
			],
			// A period one terms row covers whole is still one segment, and it is still recorded:
			// "31 of 31 days at the contract" is a statement, and a payslip that only carries it
			// sometimes is a payslip whose reader has to know when.
			proration: segments,
			adjustments: []
		};
	};

	/**
	 * An `ENTRY` component measures exactly ONE component entry, and produces exactly one adjustment.
	 *
	 * It used to sum every entry on the component into a single line and link that line to
	 * whichever one happened to be last — which is a line whose provenance was arbitrary. A row
	 * names one captured input now, so the arbitrary choice has nowhere left to be made.
	 */
	const measureEntry = (
		definition: Extract<ComponentDefinition, { source: 'ENTRY' }>,
		entry: ComponentEntry
	): Measurement | null => {
		const cap =
			definition.cap == null
				? null
				: resolveEntryCap({
						cap: definition.cap,
						component: options.component,
						entry,
						bundle: options.bundle,
						subject: options.subject,
						context: options.context(),
						leaveYearStartMonth: Number(options.configuration.company.leave_year_start_month)
					});
		const percentage = cap?.percentage ?? 100;
		const sign = entrySign(entry);
		const recurring = recurringRange(entry);
		const fraction = prorates(entry)
			? prorationFraction({
					jurisdiction: options.configuration.jurisdiction,
					period: options.salary,
					covered:
						recurring == null
							? options.employed
							: (intersectDays(
									{ start: recurring.start, end: recurring.end ?? options.salary.end },
									options.employed
								) ?? null),
					workingDaysIn: options.workingDaysIn
				})
			: 1;
		if (fraction <= 0) return null;
		// The reimbursable share is an economic fact per claim, so it is rounded per entry.
		const reimbursable = cents((Number(entry.amount) * fraction * percentage) / 100);
		if (
			cap != null &&
			cap.exceededBy + reimbursable > cap.amount &&
			definition.cap?.on_exceed === 'BLOCK'
		)
			throw new Error(
				`${options.component.code} entitlement exceeded for ${options.bundle.employment.employee_number}: ` +
					`${cents(cap.exceededBy + reimbursable).toFixed(2)} requested against ${cents(cap.amount).toFixed(2)} allowed.`
			);
		const amount = cents(sign * reimbursable);
		const quantity = sign * Number(entry.quantity ?? 0);
		assertWithinEntry({
			entry,
			componentCode: options.component.code,
			consumed: options.consumedEntries.get(entry.id) ?? 0,
			proposed: amount,
			period: options.period
		});
		return {
			amount,
			base: [],
			proration: [],
			adjustments: [
				{
					input: { family: 'COMPONENT_ENTRY', id: entry.id },
					payComponent: options.component,
					nature,
					label: options.component.code,
					amount,
					quantity: quantity === 0 ? null : quantity,
					rate: null,
					statutoryRuleKey: null
				}
			]
		};
	};

	/**
	 * A `FORMULA` component is a CEL expression over everything measured so far this payslip.
	 *
	 * Where the formula is an unpaid absence it has sources — the leave requests whose days it
	 * priced — and one row cannot name several, so the amount is apportioned across them by the days
	 * each contributed and the rounding residue lands on the last. The parts sum to the amount the
	 * formula produced, and their quantities sum to the days it was produced from. Every other
	 * formula is caused by no record anybody can edit, so it is base.
	 */
	const measureFormula = (
		definition: Extract<ComponentDefinition, { source: 'FORMULA' }>
	): Measurement | null => {
		const amount = evaluateFormula({
			code: options.component.code,
			expr: definition.expr,
			context: options.context()
		});
		const unpaid = options.unpaid;
		const quantity = unpaid?.days ?? null;
		if (amount === 0 && quantity == null && definition.unit !== 'RATE') return null;
		const magnitude = cents(Math.abs(amount));
		if (unpaid == null || unpaid.requests.length === 0)
			return {
				amount: magnitude,
				base: [
					{
						payComponent: options.component,
						nature,
						label: options.component.code,
						amount: magnitude,
						entry: { component_code: options.component.code, amount: magnitude }
					}
				],
				proration: [],
				adjustments: []
			};
		const totalDays = unpaid.requests.reduce((total, request) => total + request.days, 0);
		let allocated = 0;
		const adjustments = unpaid.requests.map((request, index) => {
			const last = index === unpaid.requests.length - 1;
			const share = last
				? cents(magnitude - allocated)
				: cents(totalDays === 0 ? 0 : (magnitude * request.days) / totalDays);
			allocated = cents(allocated + share);
			return {
				input: { family: 'LEAVE_REQUEST' as const, id: request.id },
				payComponent: options.component,
				nature,
				label: options.component.code,
				amount: share,
				quantity: request.days,
				rate: definition.unit === 'RATE' ? magnitude : null,
				statutoryRuleKey: null
			};
		});
		return { amount: magnitude, base: [], proration: [], adjustments };
	};

	switch (definition.source) {
		case 'SCHEDULE':
			return measureSchedule();
		case 'ENTRY':
			return options.entry == null ? null : measureEntry(definition, options.entry);
		case 'FORMULA':
			return measureFormula(definition);
	}
	throw new Error(`Unsupported component source: ${Reflect.get(definition, 'source')}`);
}

/**
 * Overtime, priced from the clocks and the statute and from nothing else.
 *
 * Every hour that reached this point has already been derived from a work day, classified against
 * the daily and calendar-month controls, and valued by one band of the jurisdiction's
 * `overtime_rules`. An adjustment is one band's segments **on one day** summed: the band triple —
 * day type, measure, band floor — plus the excess flag is the whole of what identifies the rule,
 * and it is what the row carries in place of a pay component, because there is no pay component. A
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
 * The three valuation branches are the arithmetic exactly as it was when a component owned it:
 *
 * - `ANNUALISED_CONTRACT_RATE` rounds the unit rate first and multiplies the units by it, per
 *   segment and per day, because that is what the source system does and what reproduces its
 *   figures to the cent.
 * - otherwise hourly awards accumulate multiplier-weighted hours and are priced once against the
 *   ordinary hourly rate, while stepped day-wage awards accumulate day-wage multiples.
 * - a band that comes out at zero produces no row at all, not a zero one. The day is still
 *   captured: it falls through to the junction row `measureEmployment` stores for every day it read
 *   and priced at nothing.
 */
/**
 * Everything `measureOvertime` prices: the classified segments and the rates they were derived at.
 */
type MeasureOvertimeOptions = {
	readonly segments: readonly PricedSegment[];
	readonly excess: readonly ExcessHours[];
	readonly hourlyRate: number;
	readonly dayWage: number;
	readonly overtimeCalculationMethod: OvertimeCalculationMethod;
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
		return {
			input: { family: 'WORK_DAY', id: workDayId },
			payComponent: null,
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
		let datedAmount = 0;
		for (const segment of matched) {
			hours += segment.hours;
			if (options.overtimeCalculationMethod === 'ANNUALISED_CONTRACT_RATE') {
				datedAmount += annualisedSegmentAmount(segment, options.hourlyRate, options.dayWage);
				continue;
			}
			if (segment.award === 'DAY_WAGE_MULTIPLE') {
				dayWageAmount += segment.multiple * options.dayWage;
				continue;
			}
			weighted += segment.hours * segment.multiple;
		}
		const amount =
			options.overtimeCalculationMethod === 'ANNUALISED_CONTRACT_RATE'
				? cents(datedAmount)
				: cents(weighted * options.hourlyRate + dayWageAmount);
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
		const amount =
			options.overtimeCalculationMethod === 'ANNUALISED_CONTRACT_RATE'
				? annualisedExcessAmount(matched, options.hourlyRate, options.dayWage)
				: cents(units * rate);
		if (amount === 0) continue;
		rows.push(asAdjustment(key.band, key.workDayId, true, { amount, quantity: hours, rate }));
	}

	return rows;
}

/**
 * One segment's worth under the `ANNUALISED_CONTRACT_RATE` order of operations: the unit rate
 * rounds first, then multiplies the units — per segment and per day — because that is what the
 * source system does and what reproduces its figures to the cent.
 */
function annualisedSegmentAmount(
	segment: PricedSegment,
	hourlyRate: number,
	dayWage: number
): number {
	const multiple = segment.multiple;
	const unitRate =
		segment.award === 'DAY_WAGE_MULTIPLE'
			? cents(dayWage * multiple)
			: cents(hourlyRate * multiple);
	const units = segment.award === 'DAY_WAGE_MULTIPLE' ? 1 : segment.hours;
	return cents(units * unitRate);
}

/**
 * Excess rows to money under the `ANNUALISED_CONTRACT_RATE` same order: a day-wage row is its
 * valued multiple, an hourly row its hours at an already-rounded unit rate.
 */
function annualisedExcessAmount(
	rows: readonly ExcessHours[],
	hourlyRate: number,
	dayWage: number
): number {
	return cents(
		rows.reduce((total, row) => {
			if (row.valuedAt === 'ORDINARY_DAY_WAGE') return total + cents(row.units * dayWage);
			const multiple = row.hours === 0 ? 0 : row.units / row.hours;
			return total + cents(row.hours * cents(hourlyRate * multiple));
		}, 0)
	);
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
