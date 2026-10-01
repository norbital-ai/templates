/** Families prepare their own inputs and calculations. This coordinator preserves the family pipeline and contribution staging. */
import { decodeNumber } from '../wire.js';
import {
	atWorksite,
	type CatalogueComponent,
	type Configuration
} from '../../lib/payroll/run/configuration.js';
import type { EmploymentBundle } from '../../lib/payroll/run/gather.js';
import {
	accumulatePayslip,
	accumulateSettledPayslip,
	dayFactTotals,
	deriveLines,
	sumAccumulations,
	type AccumulatedPayslip,
	type QuantityPayment,
	type MonthPrior
} from '../../lib/payroll/run/accumulate.js';
import {
	daysBetween,
	inclusiveDays,
	completedMonths,
	addDays,
	monthDays,
	monthBounds,
	monthKey,
	periodMonth,
	requiredDateKey
} from '../../lib/payroll/run/dates.js';
import type { WorkspaceRow } from '../rows.js';
import { coversDate } from '../../lib/payroll/run/effective.js';
import { personContext } from '../../lib/payroll/run/eligibility.js';
import {
	closesTaxYear,
	taxYearBounds,
	type PayCadence,
	type PayrollWindow
} from '../../lib/payroll/run/period.js';
import {
	calculateLeavePayroll,
	unpaidLeaveDays,
	fullyUnpaidDays,
	leaveCoverage
} from '../leave/payroll.js';
import { leaveEncashmentRate } from '../leave/encashment-rate.js';
import { settle } from '../../lib/payroll/run/settle.js';
import { employmentDates } from '../../lib/payroll/run/settlement.js';
import { prorationSegment } from '../../lib/payroll/run/proration.js';
import { stint } from '../employment-contract.js';
import {
	CONTRACT,
	LEAVE_ABSENCE,
	LEAVE_DAYS,
	OVERTIME_FLOOR_DAYS,
	WAGES
} from '../expressions/person-functions.js';
import type { PayslipProration } from '../datatypes/payslip_proration.js';
import type { InLieuSlice, PayrollTrace } from '../datatypes/payroll_trace.js';
import { openingsOf, type PayslipWageMonth } from './history.js';
import type {
	MeasuredEmployment,
	MeasureEmploymentOptions,
	YearContext,
	MeasuredBase,
	MeasuredAdjustment
} from './family.js';
import { baseLine, settlementBucket } from './family.js';
import { requestIsDue, prepareMoneySteps, type PreparedPayRequest } from './money.js';
import { prepareWorkContext, calculateWorkAttendance, prepareWorkSteps, termsAt } from './work.js';
import { measureLoanRecoveries, validateLoanRecoveries } from './loan.js';
import type { RunIssue } from '../../lib/payroll/run/validate.js';
export function calculateFamilies(options: MeasureEmploymentOptions): MeasuredEmployment {
	/** What the family measurements reported about the requests they read and did not pay. */
	const notes: RunIssue[] = [];
	const { bundle } = options;
	const referenceWageIds = new Set<string>();
	// A request prices under the catalogue row it was raised against; its bands carry the opt-ins, so
	// a scheme sealed after that revision is simply not opted into (silence means no effect).
	const configuration = options.configuration;
	// The attendance window is the employment's, not the run's: a leaver settling in their final
	// period is measured to the exit date, because no later run will ever read those days.
	const attendance = bundle.attendance;
	const employed = bundle.employedDays;
	if (employed == null) {
		/** An ended contract charges no attendance: the unpaid days are the leave's own. */
		const unpaidDaysIn = (window: { readonly start: string; readonly end: string }) =>
			unpaidLeaveDays(bundle.leave, window);
		const currency = configuration.jurisdiction.payroll.currency;
		// An OFF_CYCLE or CORRECTION run takes this branch for a person still employed (engine.ts
		// `population`): their requests are priced on the window's last day.
		const finalDate = employmentDates(bundle.employment).exit ?? options.salary.end;
		const leave = calculateLeavePayroll({
			prepared: bundle.leave,
			window: options.salary,
			dueThrough: options.salary.end,
			currency,
			absenceRate: () => {
				throw new Error('An ended employment cannot acquire new time-off charges in this period.');
			},
			encashmentRate: (entry) =>
				leaveEncashmentRate({
					bundle,
					configuration,
					entry,
					referenceWageIds,
					earnedByMonth: options.earnedByMonth
				})
		});
		const finalTerms = termsAt(bundle, finalDate);
		const cadence: PayCadence = {
			company: configuration.company,
			payFrequency: bundle.payFrequency
		};
		// An ended contract settles the claims and ad hoc requests it still owes.
		const requests = bundle.payRequests.filter((request) =>
			requestIsDue(
				request,
				options.period,
				options.salary,
				configuration.company.pay_cutoff_day,
				cadence
			)
		);

		const componentAmounts = new Map<string, number>();
		const adjustments: MeasuredAdjustment[] = [...leave.adjustments];
		const subject = personContext({
			employee: bundle.employee,
			employment: stint(bundle.employment, configuration.jurisdiction.exit_facts ?? []),
			fixedAllowances: contractAllowancesOn(bundle, configuration, finalDate),
			terms: finalTerms,
			children: bundle.children,
			company: configuration.company,
			asOf: finalDate
		});
		for (const step of prepareMoneySteps({
			bundle,
			configuration,
			year: () =>
				yearContextOf({
					bundle,
					configuration,
					options,
					componentAmounts,
					absence: absenceOf(leave.adjustments)
				}),
			salary: options.salary,
			employed: { start: finalDate, end: finalDate },
			contracted: { start: finalDate, end: finalDate },
			requests,
			consumedEntries: options.consumedEntries,
			earnedByMonth: options.earnedByMonth,
			period: options.period,
			workingDaysIn: () => 0,
			unpaidDaysIn,
			instalments: 1,
			rates: { ordinaryDay: 0, ordinaryHour: 0 },
			subject,
			note: (issue: RunIssue) => notes.push(issue)
		})) {
			const measured = step.calculate();
			if (measured == null) continue;
			const total = (componentAmounts.get(step.item.code) ?? 0) + measured.amount;
			componentAmounts.set(step.item.code, total);
			adjustments.push(...measured.adjustments);
		}

		const repaymentRecoveries = measureLoanRecoveries({
			bundle,
			configuration,
			period: options.period,
			cutoffDay: configuration.company.pay_cutoff_day,
			cadence,
			subject
		});
		for (const recovery of repaymentRecoveries) {
			const total = (componentAmounts.get(recovery.label) ?? 0) + recovery.amount;
			componentAmounts.set(recovery.label, total);
			adjustments.push(recovery);
		}
		return {
			bundle,
			base: [],
			proration: [],
			adjustments,
			notes,
			captured: {
				workDays: [],
				payRequests: {
					CLAIM: requests.filter((entry) => entry.family === 'CLAIM').map((entry) => entry.id),
					ADHOC: requests.filter((entry) => entry.family === 'ADHOC').map((entry) => entry.id)
				},
				leave: leave.captures,
				loanRepayments: repaymentRecoveries.map((recovery) => recovery.input.id),
				wagePeriods: [...referenceWageIds]
			},
			arrears: null,
			componentAmounts,
			ordinaryHourlyRate: 0,
			ordinaryDayWage: 0,
			overtimeDays: [],
			calendarMonthOvertimeHours: new Map(),
			calendarMonthAllOvertimeHours: new Map(),
			currency,
			schedule: new Map(),
			limits: [],
			periodWorkingDays: 0,
			periodUnpaidDays: 0,
			periodFullyUnpaidDays: 0,
			periodLeaveDays: {},
			periodFullLeaveDays: {},
			periodLeavePay: {},
			periodOvertimeDays: 0,
			week: { ordinary_hours_per_week: 0, working_days_per_week: 0 }
		};
	}
	const work = prepareWorkContext({
		bundle,
		configuration,
		salary: options.salary,
		employed,
		referenceWageIds
	});
	const {
		wageDays,
		closingTerms,
		rateTerms,
		currency,
		hourlyRate,
		dayWage,
		schedule,
		workingDaysIn,
		subject
	} = work;
	const cutoffDay = configuration.company.pay_cutoff_day;
	// The default pay period is answered in the grammar this employment is paid in: a half at a
	// semi-monthly company for semi-monthly terms, the `-2` run there for monthly terms, the month
	// everywhere else. See `defaultPayPeriod`.
	const cadence: PayCadence = {
		company: configuration.company,
		payFrequency: rateTerms.pay_frequency
	};
	// A deferred period's wages are the salary and the allowances on the contract; the requests
	// that settled there are settled once, by the run that pays them.
	const periodEntries = options.deferredWagesOnly
		? []
		: bundle.payRequests.filter((request) =>
				requestIsDue(request, options.period, options.salary, cutoffDay, cadence)
			);
	const entriesByComponent = Map.groupBy(periodEntries, (entry) => entry.catalogue_id);
	const entryTotalByComponentId = new Map<string, number>();
	for (const component of configuration.catalogueComponents) {
		entryTotalByComponentId.set(
			component.id,
			(entriesByComponent.get(component.id) ?? []).reduce(
				(total, entry) => total + entry.sign * decodeNumber(entry.amount),
				0
			)
		);
	}

	const workAttendance = calculateWorkAttendance({
		bundle,
		configuration,
		work,
		entryTotalByComponentId,
		priorOvertimeHours: options.priorOvertimeHours,
		priorInLieu: options.priorInLieu
	});
	const {
		overtimeDays,
		calendarMonthOvertimeHours,
		calendarMonthAllOvertimeHours,
		calendarMonthLimitHours,
		nightShiftHours
	} = workAttendance;
	notes.push(...workAttendance.inLieuNotes);
	/**
	 * The unpaid days an allowance loses, for the jurisdictions whose allowances lose them
	 * (`payroll.allowance_npl_prorates`): the no-pay leave this run charges and the rostered days
	 * with no punch it deducts, over the window the allowance actually covers. Unpaid leave and
	 * absence are charged over the ATTENDANCE window, so an allowance that covers the whole salary
	 * month is netted by that window — the salary window would count the days of the next run's
	 * cut-off and miss the days of this one's; a part-month allowance is netted by its own days.
	 */
	const unpaidDaysIn = (window: { readonly start: string; readonly end: string }) => {
		const span =
			window.start <= options.salary.start && window.end >= options.salary.end
				? attendance
				: window;
		return (
			unpaidLeaveDays(bundle.leave, span) +
			workAttendance.absentDays
				.filter((day) => day.date >= span.start && day.date <= span.end)
				.reduce((total, day) => total + day.days, 0)
		);
	};
	const leaveOptions = {
		prepared: bundle.leave,
		includeMonetary: !options.deferredWagesOnly,
		window: attendance,
		targetWindow: options.salary,
		dueThrough: options.salary.end,
		currency,
		absenceRate: work.absenceRate,
		absenceCeiling: work.absenceCeiling,
		absenceHourlyRate: work.absenceHourlyRate,
		outpatientSickExcludedRate: work.outpatientSickExcludedRate,
		encashmentRate: (entry: Parameters<typeof leaveEncashmentRate>[0]['entry']) =>
			leaveEncashmentRate({
				bundle,
				configuration,
				entry,
				referenceWageIds,
				earnedByMonth: options.earnedByMonth
			})
	};
	let measuredLeave = calculateLeavePayroll(leaveOptions);

	const componentAmounts = new Map<string, number>();
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
			: (entriesByComponent.get(calculatedArrears.componentCatalogueId) ?? []).find(
					(entry) =>
						cents(entry.sign * decodeNumber(entry.amount), currency) === calculatedArrears.amount
				);
	// A distinct arrears period is a different month (or a different amount story keyed as an
	// entry). Measuring this same period again as "arrears" is double-pay: two BASIC lines and
	// statutory charged on both.
	const arrears =
		explicitArrears == null &&
		calculatedArrears != null &&
		calculatedArrears.period !== options.period
			? calculatedArrears
			: null;

	// ── walk the families in pipeline order: leave coverage, then work, then the money requests ─
	const base: MeasuredBase[] = [];
	const proration: PayslipProration[] = [];
	const adjustments: MeasuredAdjustment[] = [];
	// Leave coverage lands before the work steps that read it; nothing declares an order, and no
	// amount depends on one — the buckets are summed in SETTLE.
	adjustments.push(...measuredLeave.adjustments);
	if (arrears != null) {
		const component = configuration.catalogueComponents.find(
			(row) => row.id === arrears.componentCatalogueId
		);
		if (component == null)
			throw new Error(
				`${bundle.employment.employee_number} is owed ${arrears.period}, but the component it is ` +
					'paid back on is not in this company’s catalogue.'
			);
		// Derived back pay points at nothing a person can edit — the deferral rule and the earlier
		// month's own contract produced it — so it is base, exactly like the wage it stands in for,
		// and it rides the wage's own component: a second base line under the same code, which
		// every total sums.
		base.push(
			baseLine(
				component,
				settlementBucket(component.destination, component.direction),
				arrears.amount
			)
		);
		componentAmounts.set(component.code, arrears.amount);
	}
	// What was recorded in the previous period after its salary was settled early: priced there, paid here.
	const late = measureLateRecords(options);
	for (const line of late?.adjustments ?? []) {
		adjustments.push(line);
		componentAmounts.set(
			line.catalogueComponent.code,
			(componentAmounts.get(line.catalogueComponent.code) ?? 0) + line.amount
		);
	}
	const salaryBase = () =>
		base.reduce(
			(sum, line) => (line.catalogueComponent.output === 'salary' ? sum + line.amount : sum),
			0
		);
	/**
	 * The leave this payslip settles — the attendance window's, as the leave lines above charge it —
	 * priced on the salary lines measured so far, so an entry reads it after the wage steps.
	 */
	const settledLeave = leaveCoverage(bundle.leave, attendance, work.isOrdinaryWorkingDay);
	const leavePeriod = () => ({
		leave_days: settledLeave.byCode,
		leave_full_days: settledLeave.fullDaysByCode,
		leave_pay: leavePay(settledLeave.byCode, salaryBase(), workingDaysIn(attendance), currency)
	});
	const stepOptions = {
		bundle,
		configuration,
		leavePeriod,
		year: () =>
			yearContextOf({
				bundle,
				configuration,
				options,
				componentAmounts,
				absence: absenceOf(measuredLeave.adjustments) + absenceOf(workAttendance.adjustments)
			}),
		salary: options.salary,
		employed: wageDays,
		contracted: employed,
		consumedEntries: options.consumedEntries,
		earnedByMonth: options.earnedByMonth,
		period: options.period,
		workingDaysIn,
		holidayPayEligible: work.holidayPayEligible,
		unpaidDaysIn,
		instalments: rateTerms.pay_frequency === 'SEMI_MONTHLY' ? 2 : 1,
		rates: { ordinaryDay: dayWage, ordinaryHour: hourlyRate },
		unpaidSalary: () =>
			Math.max(
				0,
				salaryBase() -
					absenceOf(measuredLeave.adjustments) -
					absenceOf(workAttendance.adjustments) -
					adjustments.reduce(
						(sum, row) =>
							row.catalogueComponent.reduces_unpaid_salary === true ? sum + row.amount : sum,
						0
					)
			),
		subject,
		note: (issue: RunIssue) => notes.push(issue)
	};
	const retainedByDate = new Map<string, number>();
	const unattributedRetained: string[] = [];
	const steps = [
		...prepareWorkSteps(stepOptions),
		...prepareAllowanceSteps({
			...stepOptions,
			unpaidCharges: daysBetween(attendance.start, attendance.end).flatMap((date) => {
				const days =
					unpaidLeaveDays(bundle.leave, { start: date, end: date }, true) +
					workAttendance.absentDays
						.filter((day) => day.date === date)
						.reduce((sum, day) => sum + day.days, 0);
				return days > 0 ? [{ date, days }] : [];
			}),
			unpaidDaysIn: (window) => {
				const span =
					window.start <= options.salary.start && window.end >= options.salary.end
						? attendance
						: window;
				return (
					unpaidLeaveDays(bundle.leave, span, true) +
					workAttendance.absentDays
						.filter((day) => day.date >= span.start && day.date <= span.end)
						.reduce((total, day) => total + day.days, 0)
				);
			}
		})
	];
	for (const step of steps) {
		const measured = step.calculate();
		if (measured == null) continue;
		const component = step.item;
		if (
			(component.family === 'WORK' || component.family === 'ALLOWANCE') &&
			component.destination === 'PAY' &&
			component.direction === 'ADD' &&
			!(configuration.work.wage_excluded_allowances ?? []).includes(component.code)
		) {
			if (component.family === 'ALLOWANCE' && measured.amount !== 0 && measured.datedCash == null)
				unattributedRetained.push(component.code);
			for (const cash of measured.datedCash ?? [])
				retainedByDate.set(cash.date, (retainedByDate.get(cash.date) ?? 0) + cash.amount);
		}
		const running = (componentAmounts.get(component.code) ?? 0) + measured.amount;
		componentAmounts.set(component.code, running);
		base.push(...measured.base);
		proration.push(...measured.proration);
		adjustments.push(...measured.adjustments);
	}

	if (Object.keys(bundle.leave.targetContexts ?? {}).length > 0) {
		const earlier = measuredLeave;
		measuredLeave = calculateLeavePayroll({
			...leaveOptions,
			ordinaryDayRate: (charge) => work.ratesOn(charge.date).dayWage,
			retainedCash: (charge) => {
				if (unattributedRetained.length > 0)
					refuse(
						`Leave cash target cannot attribute retained wage allowances: ${unattributedRetained.join(', ')}.`
					);
				const withheld = earlier.captures
					.flatMap((capture) => capture.pay_items)
					.filter((item) => item.date === charge.date && item.bucket === 'ABSENCE')
					.reduce((sum, item) => sum + item.amount, 0);
				return Math.max(0, (retainedByDate.get(charge.date) ?? 0) * charge.days - withheld);
			}
		});
		adjustments.splice(0, earlier.adjustments.length, ...measuredLeave.adjustments);
	}
	// Money reads the salary and Leave targets measured above.
	for (const step of prepareMoneySteps({ ...stepOptions, requests: periodEntries }).toSorted(
		(a, b) =>
			a.item.code === b.item.code
				? a.item.id.localeCompare(b.item.id)
				: a.item.code.localeCompare(b.item.code)
	)) {
		const measured = step.calculate();
		if (measured == null) continue;
		componentAmounts.set(
			step.item.code,
			(componentAmounts.get(step.item.code) ?? 0) + measured.amount
		);
		base.push(...measured.base);
		proration.push(...measured.proration);
		adjustments.push(...measured.adjustments);
	}

	adjustments.push(...workAttendance.adjustments);
	// E6: the lines the period's totals decide, read after every work, leave and money line.
	const derivedLines = configuration.jurisdiction.work_rules.derived_lines ?? [];
	if (derivedLines.length > 0)
		for (const line of deriveLines({
			rules: derivedLines,
			items: [...base, ...adjustments],
			components: configuration.catalogueComponents,
			context: {
				...subject,
				day_facts: dayFactTotals(
					bundle.workDays.map((day) => ({ date: dateKey(day.work_date), facts: day.facts })),
					attendance
				)
			},
			currency,
			ordinaryHour: hourlyRate
		})) {
			base.push(line);
			componentAmounts.set(
				line.catalogueComponent.code,
				(componentAmounts.get(line.catalogueComponent.code) ?? 0) + line.amount
			);
		}

	const repaymentRecoveries = options.deferredWagesOnly
		? []
		: measureLoanRecoveries({
				bundle,
				configuration,
				period: options.period,
				cutoffDay,
				cadence,
				subject
			});
	for (const recovery of repaymentRecoveries) {
		const running = (componentAmounts.get(recovery.label) ?? 0) + recovery.amount;
		componentAmounts.set(recovery.label, running);
		adjustments.push(recovery);
	}

	/**
	 * The captured inputs, by family: the source rows whose `payslip_id` the run pins.
	 *
	 * The pins ARE the settlement lock: every source the run READ is pinned, whether or not it
	 * produced money — "consumed nothing" and "was never read" are different claims, and only the
	 * first is a capture. The lock reads the pin, never the adjustments, because an input that prices
	 * to zero has an output of nothing and still holds its claim.
	 *
	 * The span is the union of the attendance window and the wage window, because both are consumed —
	 * attendance prices the days worked, and the wage window is what recurring salary covers. The
	 * band GATHER reads is wider than the run prices — both calendar months the cutoff touches, so
	 * the monthly statutory overtime counter can reset — and those extra days belong to a
	 * neighbouring period. Capturing them would freeze attendance a future run has not settled yet.
	 */
	const capturedWorkDayIds = [...new Set(workAttendance.capturedWorkDayIds)];
	const month = monthBounds(periodMonth(options.period));
	const monthThrough = {
		...month,
		end: options.salary.end < month.end ? options.salary.end : month.end
	};
	const dates = employmentDates(bundle.employment);
	const monthlyProration = prorationSegment({
		work: configuration.work,
		person: subject,
		period: month,
		covered: { start: dates.hire, end: dates.exit ?? month.end },
		workingDaysIn
	});
	const periodLeave = leaveCoverage(bundle.leave, options.salary, work.isOrdinaryWorkingDay);
	const monthlyLeave = leaveCoverage(bundle.leave, monthThrough, work.isOrdinaryWorkingDay);
	const periodWorking = workingDaysIn(options.salary);
	const monthWorking = workingDaysIn(month);

	return {
		bundle,
		...(late == null ? {} : { lateMonth: late.month }),
		base,
		proration,
		adjustments,
		captured: {
			workDays: [...capturedWorkDayIds, ...(late?.workDays ?? [])],
			payRequests: {
				CLAIM: periodEntries.filter((entry) => entry.family === 'CLAIM').map((entry) => entry.id),
				ADHOC: periodEntries.filter((entry) => entry.family === 'ADHOC').map((entry) => entry.id)
			},
			leave: [...measuredLeave.captures, ...(late?.leave ?? [])],
			loanRepayments: repaymentRecoveries.map((recovery) => recovery.input.id),
			wagePeriods: [...referenceWageIds]
		},
		arrears,
		notes,
		componentAmounts,
		ordinaryHourlyRate: hourlyRate,
		ordinaryDayWage: dayWage,
		overtimeDays,
		calendarMonthOvertimeHours,
		calendarMonthAllOvertimeHours,
		calendarMonthLimitHours,
		settledOvertimeHours: addHours(workAttendance.settledOvertimeHours, late?.overtimeHours),
		inLieuSlices: workAttendance.inLieuSlices,
		currency,
		schedule,
		normalWorkingDaysIn: workingDaysIn,
		limits: workAttendance.limits,
		periodWorkingDays: subject.period.working_days,
		periodUnpaidDays: unpaidDaysIn(options.salary),
		periodFullyUnpaidDays: fullyUnpaidDays(
			bundle.leave,
			options.salary,
			work.absentDaysIn(options.salary),
			work.isOrdinaryWorkingDay
		),
		periodLeaveDays: periodLeave.byCode,
		periodFullLeaveDays: periodLeave.fullDaysByCode,
		periodLeavePay: leavePay(periodLeave.byCode, salaryBase(), periodWorking, currency),
		periodOvertimeDays: [...workAttendance.overtimeOrNightDates].filter(
			(date) => date >= attendance.start && date <= attendance.end
		).length,
		monthlyContributionDays: {
			employed: monthlyProration?.days ?? 0,
			working: workingDaysIn(month),
			fullyUnpaid: fullyUnpaidDays(
				bundle.leave,
				monthThrough,
				work.absentDaysIn(monthThrough),
				work.isOrdinaryWorkingDay
			),
			leaveDays: monthlyLeave.byCode,
			fullLeaveDays: monthlyLeave.fullDaysByCode,
			leavePay: leavePay(monthlyLeave.byCode, subject.terms.monthly_basic, monthWorking, currency),
			overtimeDays: [...workAttendance.overtimeOrNightDates].filter(
				(date) => date >= monthThrough.start && date <= monthThrough.end
			).length,
			unpaid:
				unpaidLeaveDays(bundle.leave, monthThrough) +
				work.absentDaysIn(monthThrough).reduce((total, day) => total + day.days, 0)
		},
		week: {
			ordinary_hours_per_week: rateTerms.ordinary_hours_per_week,
			working_days_per_week: rateTerms.working_days_per_week
		}
	};
}

/**
 * The salary a window attributes to each leave code's days: salary × days ÷ working days, never
 * more than the salary — for a law that exempts the pay of one leave (PH RA 11210 s.5 maternity).
 */
function leavePay(
	days: Readonly<Record<string, number>>,
	salary: number,
	working: number,
	currency: string
): Record<string, number> {
	return Object.fromEntries(
		Object.entries(days).map(([code, count]) => [
			code,
			working > 0 ? cents(Math.min(salary, (salary * count) / working), currency) : 0
		])
	);
}

/**
 * What the deferred period would have paid, measured by measuring it.
 *
 * The bundle is rebuilt against the earlier month — its own employed days, its own attendance
 * window, and only the entries and clocks that fall inside it — and then handed back to
 * `calculateFamilies`. The number that comes out is that month's gross: prorated wage, standing
 * allowances, whatever settled there, less anything unpaid. It is the same arithmetic the person
 * would have seen on a payslip, which is the only defensible definition of what they are owed.
 */
function measureArrears(
	options: Pick<
		MeasureEmploymentOptions,
		'bundle' | 'configuration' | 'periodsRemaining' | 'headcount' | 'consumedEntries'
	>
): MeasuredEmployment['arrears'] {
	const owed = options.bundle.arrearsFor;
	// The arrears rides the contracted wage's own component: what a deferred month owes is that
	// month's wage, and there is no second catalogue row to carry it under.
	const componentCatalogueId = options.configuration.catalogueComponents.find(
		(component) => component.family === 'WORK' && component.output === 'salary'
	)?.id;
	if (owed == null || componentCatalogueId == null) return null;
	const measured = calculateFamilies({
		deferredWagesOnly: true,
		yearEarned: new Map(),
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
		// Carried through rather than emptied, so the deferred pass sees the same consumption facts
		// this one does. Its deductions are discarded either way — only `gross` is read below — but a
		// second, differently-informed view of the same sources is the kind of thing that is true
		// until somebody reads more than gross out of it.
		consumedEntries: options.consumedEntries
	});
	// The deferred period's gross uses the same settlement arithmetic. Earnings-based contributions
	// read it when paid; calendar-based insurance remains assessed in its own coverage month.
	const amount = settle({
		base: measured.base,
		adjustments: measured.adjustments,
		charges: [],
		currency: measured.currency
	}).gross;
	return amount <= 0 ? null : { period: owed.period, componentCatalogueId, amount };
}

import { cents } from '../../lib/payroll/run/rounding.js';
import type { GatheredRun } from '../../lib/payroll/run/gather.js';

type OvertimeHours = NonNullable<MeasuredEmployment['settledOvertimeHours']>;

/** Two overtime counts, limit by limit and month by month; `sign` −1 subtracts the second. */
function addHours(
	first: OvertimeHours | undefined,
	second: OvertimeHours | undefined,
	sign = 1
): OvertimeHours | undefined {
	if (second == null) return first;
	const out = new Map([...(first ?? [])].map(([limit, months]) => [limit, new Map(months)]));
	for (const [limit, months] of second) {
		const into = out.get(limit) ?? new Map<string, number>();
		for (const [month, hours] of months) into.set(month, (into.get(month) ?? 0) + sign * hours);
		out.set(limit, into);
	}
	return out;
}

/**
 * The lines of the records dated in the previous period after an EARLY run settled its salary (`bundle.late`).
 *
 * The previous period is measured as it stands now, on its own windows, terms and days, and again without the
 * late records: the late records' own lines are what this period pays, as its own lines, priced on the day they
 * were worked or taken; their pins move with them. Everything the EARLY slip already settled is left where it is.
 * A late record that would change any line but its own is refused rather than half-settled.
 */
function measureLateRecords(options: MeasureEmploymentOptions): {
	readonly adjustments: readonly MeasuredAdjustment[];
	readonly workDays: readonly string[];
	readonly leave: MeasuredEmployment['captured']['leave'];
	readonly overtimeHours: OvertimeHours | undefined;
	readonly month: MeasuredEmployment;
} | null {
	const late = options.bundle.late;
	if (late == null || options.deferredWagesOnly) return null;
	const pass = (withLate: boolean) =>
		calculateFamilies({
			...options,
			deferredWagesOnly: true,
			priorOvertimeHours: undefined,
			period: late.window.period,
			salary: late.window.salary,
			bundle: {
				...options.bundle,
				window: late.window,
				workDays: withLate ? late.workDays : late.workDays.filter((row) => !late.ids.has(row.id)),
				leave: withLate
					? options.bundle.leave
					: {
							...options.bundle.leave,
							entries: options.bundle.leave.entries.filter((row) => !late.ids.has(row.id))
						},
				employedDays: late.employedDays,
				wageDays: late.wageDays,
				attendance: late.attendance,
				arrearsFor: null,
				deferral: null,
				late: null,
				payRequests: [],
				loanRepayments: []
			}
		});
	const now = pass(true);
	const then = pass(false);
	const isLate = (line: MeasuredAdjustment) => late.ids.has(line.input.id);
	const totals = (
		lines: readonly {
			readonly catalogueComponent: { code: string };
			readonly amount: number;
			readonly bucket: string;
		}[]
	) => {
		const sums = new Map<string, number>();
		for (const line of lines) {
			const key = `${line.bucket}:${line.catalogueComponent.code}`;
			sums.set(key, cents((sums.get(key) ?? 0) + line.amount, now.currency));
		}
		return JSON.stringify([...sums].toSorted(([a], [b]) => a.localeCompare(b)));
	};
	if (
		totals(now.base) !== totals(then.base) ||
		totals(now.adjustments.filter((line) => !isLate(line))) !== totals(then.adjustments)
	)
		refuse(
			`${options.bundle.employment.employee_number}: a record dated in ${late.window.period}, recorded after that ` +
				'salary was settled early, changes more of that period than its own line. Correct it with an ad hoc line in this period.'
		);
	return {
		adjustments: now.adjustments.filter(isLate).map((line) => ({
			...line,
			label: `${line.label} (${late.window.period})`,
			earnedPeriod: late.window.period
		})),
		workDays: now.captured.workDays.filter((id) => late.ids.has(id)),
		leave: now.captured.leave.filter((capture) => late.ids.has(capture.leave_entry_id)),
		overtimeHours: addHours(now.settledOvertimeHours, then.settledOvertimeHours, -1),
		month: now
	};
}
import { prepareMoneyConsumption } from './money.js';
import { prepareAllowanceSteps } from './allowances.js';
import { contractAllowancesOn } from './contract-allowances.js';
import { contributionYearToDate } from './contribution.js';
import { buildStatutoryHistory } from './history.js';
import type { PayrollWorld } from './world.js';

/**
 * The earlier instalments of each calendar month, per employee: what they settled (re-folded into
 * an accumulation) and what each scheme charged on them. A MONTH-assessed scheme at a
 * semi-monthly or weekly cadence prices the month on the sum and charges the difference.
 */
function monthPriorOf(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly periodByRun: ReadonlyMap<string, string>;
	readonly catalogueComponents?: readonly CatalogueComponent[] | undefined;
}): Map<string, MonthPrior> {
	const componentsByCode = new Map(
		(options.catalogueComponents ?? []).map((component) => [component.code, component])
	);
	const parts = new Map<
		string,
		{
			accumulations: AccumulatedPayslip[];
			earned: Map<string, number>;
			charged: Map<
				string,
				{
					employee: number;
					employer: number;
					base: number;
					ordinary: number;
					rebate: number;
				}
			>;
		}
	>();
	for (const payslip of options.payslips) {
		const period = options.periodByRun.get(payslip.payroll_run_id);
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		if (period == null || employeeId == null) continue;
		// The month, and at a finer cadence the pay period itself (`YYYY-MM-2`): a PAY_PERIOD scheme
		// bills the period as the month's schemes bill the month.
		for (const key of new Set([`${employeeId}:${period.slice(0, 7)}`, `${employeeId}:${period}`]))
			addPrior(key, payslip);
	}
	function addPrior(key: string, payslip: WorkspaceRow<'payslips'>) {
		const entry = parts.get(key) ?? {
			accumulations: [] as AccumulatedPayslip[],
			earned: new Map<string, number>(),
			charged: new Map<
				string,
				{
					employee: number;
					employer: number;
					base: number;
					ordinary: number;
					rebate: number;
				}
			>()
		};
		entry.accumulations.push(accumulateSettledPayslip(payslip, componentsByCode));
		for (const [code, amount] of earnedLines(payslip))
			entry.earned.set(code, (entry.earned.get(code) ?? 0) + amount);
		for (const charge of payslip.statutory) {
			const running = entry.charged.get(charge.scheme_code) ?? {
				employee: 0,
				employer: 0,
				base: 0,
				ordinary: 0,
				rebate: 0
			};
			entry.charged.set(charge.scheme_code, {
				employee: running.employee + charge.employee_amount,
				employer: running.employer + charge.employer_amount,
				base: running.base + charge.base_amount,
				ordinary: running.ordinary + (charge.ordinary_amount ?? 0),
				rebate: running.rebate + (charge.rebate_amount ?? 0)
			});
		}
		parts.set(key, entry);
	}
	return new Map(
		[...parts].map(([key, entry]) => [
			key,
			{
				accumulation: sumAccumulations(entry.accumulations),
				earned: entry.earned,
				charged: entry.charged
			}
		])
	);
}

export function prepareFamilyHistory(
	options: Parameters<typeof contributionYearToDate>[0] & {
		readonly world: PayrollWorld;
		readonly periodByRun: ReadonlyMap<string, string>;
		/** run id → its frozen trace, which carries each payslip's settled overtime counts. */
		readonly traceByRun: ReadonlyMap<string, PayrollTrace>;
		readonly catalogueComponents?: readonly CatalogueComponent[] | undefined;
	}
) {
	return {
		yearToDate: contributionYearToDate(options),
		statutoryHistory: buildStatutoryHistory(options),
		yearEarned: earnedYearToDate(options),
		yearQuantityPayments: earnedQuantityPaymentsYearToDate(options),
		earnedByMonth: earnedByMonth({ ...options, openings: options.world.employment_wage_periods }),
		paidWagesByMonth: new Map(
			[
				...earnedByMonth({
					...options,
					payslips: options.payslips.filter(
						(slip) => slip.status === 'PAID' && slip.paid_at != null
					)
				})
			].map(([employeeId, months]) => [
				employeeId,
				new Map([...months].map(([month, codes]) => [month, codes.get(WAGES) ?? 0]))
			])
		),
		payslipWageMonths: payslipWageMonths(options),
		priorOvertimeHours: priorOvertimeHours(options),
		priorInLieu: priorInLieu(options),
		monthPrior: monthPriorOf(options),
		consumedEntries: prepareMoneyConsumption(
			options.world,
			options.payslips.map((row) => row.id)
		)
	};
}

/** Paid units remain units when a later salary changes their monetary value. */
function earnedQuantityPaymentsYearToDate(
	options: Parameters<typeof earnedYearToDate>[0] & {
		readonly periodByRun: ReadonlyMap<string, string>;
	}
): Map<string, Map<string, QuantityPayment[]>> {
	const totals = new Map<string, Map<string, QuantityPayment[]>>();
	const slips = options.payslips.toSorted(
		(a, b) =>
			(options.periodByRun.get(a.payroll_run_id) ?? '').localeCompare(
				options.periodByRun.get(b.payroll_run_id) ?? ''
			) ||
			(a.paid_at ?? '').localeCompare(b.paid_at ?? '') ||
			a.id.localeCompare(b.id)
	);
	for (const payslip of slips) {
		if (!options.inTaxYear.has(payslip.payroll_run_id)) continue;
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		if (employeeId == null) continue;
		const byCode = totals.get(employeeId) ?? new Map<string, QuantityPayment[]>();
		for (const line of payslip.adjustments) {
			if (!line.component_code.endsWith('_ENCASHMENT')) continue;
			const payments = byCode.get(line.component_code) ?? [];
			payments.push({
				period: options.periodByRun.get(payslip.payroll_run_id),
				quantity: line.quantity == null ? null : line.quantity,
				amount: (line.bucket === 'ABSENCE' ? -1 : 1) * line.amount,
				rate: line.rate == null ? null : line.rate
			});
			byCode.set(line.component_code, payments);
		}
		totals.set(employeeId, byCode);
	}
	return totals;
}

/**
 * What each employee's earlier payslips earned this tax year, by component code: the base
 * lines and every earning or non-wage payment adjustment. The year axis a scheduled
 * occurrence's amount and a base entry's annual exemption read.
 */
function earnedYearToDate(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly inTaxYear: ReadonlySet<string>;
	readonly employmentToEmployee: ReadonlyMap<string, string>;
}): Map<string, Map<string, number>> {
	const earned = new Map<string, Map<string, number>>();
	for (const payslip of options.payslips) {
		if (!options.inTaxYear.has(payslip.payroll_run_id)) continue;
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		if (employeeId == null) continue;
		const byCode = earned.get(employeeId) ?? new Map<string, number>();
		for (const [code, amount] of earnedLines(payslip))
			byCode.set(code, (byCode.get(code) ?? 0) + amount);
		earned.set(employeeId, byCode);
	}
	return earned;
}

/** What one payslip earned, as `year.earned` counts it. */
function earnedLines(payslip: WorkspaceRow<'payslips'>): [string, number][] {
	return earnedOf(payslip.base, payslip.adjustments);
}

/** Pay lines as `year.earned` counts them: the base, earnings, and every unpaid day as `ABSENCE`. */
function earnedOf(
	base: readonly { readonly component_code: string; readonly amount: number }[],
	adjustments: readonly {
		readonly component_code: string;
		readonly bucket: string;
		readonly amount: number;
	}[]
): [string, number][] {
	return [
		...base.map((line): [string, number] => [line.component_code, line.amount]),
		...adjustments.flatMap((line): [string, number][] =>
			line.bucket === 'EARNING' || line.bucket === 'NON_WAGE_PAYMENT'
				? [[line.component_code, line.amount]]
				: // Every unpaid day, absence or no-pay leave, under the reserved name: `BASIC - ABSENCE`
					// is the basic actually earned (PH PD 851: a 13th month is a twelfth of it).
					line.bucket === 'ABSENCE'
					? [[ABSENCE, line.amount]]
					: []
		)
	];
}

const ABSENCE = 'ABSENCE';

/** This run's unpaid-day lines, the magnitude `year.earned.ABSENCE` adds to the year's. */
function absenceOf(adjustments: readonly MeasuredAdjustment[]): number {
	return adjustments.reduce((sum, line) => (line.bucket === ABSENCE ? sum + line.amount : sum), 0);
}

/**
 * What each employee's earlier payslips earned, by calendar month and component code — every
 * prior run, not the tax year alone: `earned_average(code, months_back, months)` reads a window
 * of it (TW 勞保條例施行細則 §27: the three months before the February and August declarations).
 */
function earnedByMonth(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	/** Opening pay recorded before this workspace; a month no payslip settles reads its normal wages. */
	readonly openings?: readonly WorkspaceRow<'employment_wage_periods'>[];
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly periodByRun: ReadonlyMap<string, string>;
	readonly traceByRun: ReadonlyMap<string, PayrollTrace>;
	readonly catalogueComponents?: readonly CatalogueComponent[] | undefined;
}): Map<string, Map<string, Map<string, number>>> {
	const components = new Map(
		(options.catalogueComponents ?? []).map((component) => [component.code, component])
	);
	const add = (byCode: Map<string, number>, code: string, amount: number) =>
		byCode.set(code, (byCode.get(code) ?? 0) + amount);
	const earned = new Map<string, Map<string, Map<string, number>>>();
	for (const payslip of options.payslips) {
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		const month = options.periodByRun.get(payslip.payroll_run_id)?.slice(0, 7);
		if (employeeId == null || month == null) continue;
		const byMonth = earned.get(employeeId) ?? new Map<string, Map<string, number>>();
		const byCode = byMonth.get(month) ?? new Map<string, number>();
		for (const line of payslip.base)
			byCode.set(line.component_code, (byCode.get(line.component_code) ?? 0) + line.amount);
		for (const line of payslip.adjustments)
			if (line.bucket === 'EARNING' || line.bucket === 'NON_WAGE_PAYMENT') {
				byCode.set(line.component_code, (byCode.get(line.component_code) ?? 0) + line.amount);
				// Every priced work-day line — overtime, night, the funnelled hours — is also filed
				// under the reserved name, so `earned_average(["BASIC", "OVERTIME"], …)` reads a
				// month's 工資 whole (TW 施行細則 §27).
				if (line.family === 'WORK_DAY' && line.component_code !== 'OVERTIME')
					byCode.set('OVERTIME', (byCode.get('OVERTIME') ?? 0) + line.amount);
			}
		// The month's wages as the person reads them (`employment.earned_monthly_average`): the
		// contract lines (the wage and the standing allowances), the priced work and every paid line
		// of a class marked `WAGES` in its `counts_toward` — a regular payment the law counts as wages
		// (TW 勞基法 §2(3): 經常性給與 such as commission; MY EA s.2 "wages" includes commission) —
		// less every unpaid day. An unmarked ad hoc class (a year-end bonus, back pay, a
		// reimbursement) stays out: 施行細則 §10 and EA s.2(a)–(e) exclude it.
		add(byCode, WAGES, 0);
		// The contract lines by the segments that priced them, which back pay for an earlier month
		// has none of: the day a 施行細則 §2 exclusion takes out is priced on it.
		for (const segment of payslip.proration ?? []) add(byCode, CONTRACT, segment.prorated_amount);
		for (const line of payslip.base) {
			const component = components.get(line.component_code);
			if (
				component == null ||
				(component.destination === 'PAY' && component.direction !== 'SUBTRACT')
			)
				add(byCode, WAGES, line.amount);
		}
		for (const line of payslip.adjustments) {
			if (
				line.bucket === 'EARNING' &&
				(line.family === 'WORK_DAY' ||
					(components.get(line.component_code)?.counts_toward ?? []).includes(WAGES))
			)
				add(byCode, WAGES, line.amount);
			if (line.bucket !== 'ABSENCE') continue;
			add(byCode, WAGES, -line.amount);
			// Each leave code's deduction and days, for a law that leaves a leave's days out.
			if (line.family === 'LEAVE') {
				add(byCode, LEAVE_ABSENCE + line.component_code, line.amount);
				add(byCode, LEAVE_DAYS + line.component_code, line.quantity ?? 0);
			}
		}
		// The window's overtime or night days at the floor then in force, so `earned_daily_excess`
		// bounds a per-day ceiling at the minimum wage of each payslip's own time.
		const traced = options.traceByRun
			.get(payslip.payroll_run_id)
			?.find((entry) => entry.employment_id === payslip.employment_id);
		add(byCode, OVERTIME_FLOOR_DAYS, (traced?.overtime_days ?? 0) * (traced?.minimum_wage ?? 0));
		byMonth.set(month, byCode);
		earned.set(employeeId, byMonth);
	}
	const settled = new Map(
		[...earned].map(([employeeId, months]) => [employeeId, new Set(months.keys())])
	);
	for (const row of options.openings ?? []) {
		const employeeId = options.employmentToEmployee.get(row.employment_id);
		if (employeeId == null) continue;
		for (const slip of openingsOf([row])) {
			if (settled.get(employeeId)?.has(slip.wage_month)) continue;
			const byMonth = earned.get(employeeId) ?? new Map<string, Map<string, number>>();
			const byCode = byMonth.get(slip.wage_month) ?? new Map<string, number>();
			add(byCode, WAGES, slip.recorded.normal_wages);
			byMonth.set(slip.wage_month, byCode);
			earned.set(employeeId, byMonth);
		}
	}
	return earned;
}

/**
 * Each employee's earlier payslips as calendar months of pay, for a normal-wage reference (TW
 * 施行細則 §24-1: 最近一個月正常工作時間所得之工資): the contract lines by the proration segments
 * that priced them — so back pay for an earlier month, which has none, stays out — the paid lines
 * of classes marked `WAGES`, and the unpaid days. Overtime and every other priced work line are
 * not normal-hours pay and are left out.
 */
function payslipWageMonths(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly periodByRun: ReadonlyMap<string, string>;
	readonly catalogueComponents?: readonly CatalogueComponent[] | undefined;
}): Map<string, PayslipWageMonth[]> {
	const regular = new Set(
		(options.catalogueComponents ?? [])
			.filter((component) => (component.counts_toward ?? []).includes(WAGES))
			.map((component) => component.code)
	);
	const byEmployee = new Map<string, Map<string, PayslipWageMonth>>();
	for (const payslip of options.payslips) {
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		const month = options.periodByRun.get(payslip.payroll_run_id)?.slice(0, 7);
		// A slip with no contract segment (a deferred joining month, an ended contract) states no month.
		const segments = payslip.proration ?? [];
		if (employeeId == null || month == null || segments.length === 0) continue;
		const months = byEmployee.get(employeeId) ?? new Map<string, PayslipWageMonth>();
		const paid = payslip.paid_at == null ? null : payslip.paid_at.slice(0, 10);
		const earlier = months.get(month);
		const contract: Record<string, number> = { ...earlier?.contract };
		for (const segment of segments)
			contract[segment.component_code] =
				(contract[segment.component_code] ?? 0) + segment.prorated_amount;
		const froms = segments.map((segment) => segment.from);
		const tos = segments.map((segment) => segment.to);
		const lines = payslip.adjustments.map((line) => ({
			bucket: line.bucket,
			code: line.component_code,
			amount: line.amount
		}));
		months.set(month, {
			month,
			start: [...froms, ...(earlier == null ? [] : [earlier.start])].toSorted()[0]!,
			end: [...tos, ...(earlier == null ? [] : [earlier.end])].toSorted().at(-1)!,
			paid_on:
				earlier != null && earlier.paid_on == null
					? null
					: paid == null
						? null
						: [paid, earlier?.paid_on ?? paid].toSorted().at(-1)!,
			payslips: [...(earlier?.payslips ?? []), payslip.id],
			contract,
			regular:
				(earlier?.regular ?? 0) +
				lines.reduce(
					(sum, line) =>
						line.bucket === 'EARNING' && regular.has(line.code) ? sum + line.amount : sum,
					0
				),
			absence:
				(earlier?.absence ?? 0) +
				lines.reduce((sum, line) => (line.bucket === ABSENCE ? sum + line.amount : sum), 0)
		});
		byEmployee.set(employeeId, months);
	}
	return new Map([...byEmployee].map(([employeeId, months]) => [employeeId, [...months.values()]]));
}

/** The year axis of one employment in one run; `earned` reads this run's own lines as they land. */
function yearContextOf(input: {
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly options: Pick<MeasureEmploymentOptions, 'period' | 'salary' | 'yearEarned'>;
	readonly componentAmounts: ReadonlyMap<string, number>;
	/** This run's unpaid-day lines, added to the year's `ABSENCE`. */
	readonly absence: number;
}): YearContext {
	const { bundle, configuration, options, componentAmounts } = input;
	const startMonth = configuration.jurisdiction.payroll.tax_year_start_month;
	const bounds = taxYearBounds(options.period, startMonth);
	const dates = employmentDates(bundle.employment);
	const from = dates.hire > bounds.start ? dates.hire : bounds.start;
	const through =
		dates.exit != null && dates.exit < options.salary.end ? dates.exit : options.salary.end;
	const employed = through >= from;
	return {
		start: bounds.start,
		end: bounds.end,
		months_employed: employed ? completedMonths(from, addDays(through, 1)) : 0,
		days_employed: employed ? inclusiveDays(from, through) : 0,
		last_of_year:
			closesTaxYear(options.period, startMonth, bundle.window.payFrequency) ||
			(dates.exit != null && dates.exit <= options.salary.end),
		earned: Object.fromEntries(
			[
				...new Set(['BASIC', ABSENCE, ...options.yearEarned.keys(), ...componentAmounts.keys()])
			].map((code) => [
				code,
				(options.yearEarned.get(code) ?? 0) +
					(code === ABSENCE ? input.absence : (componentAmounts.get(code) ?? 0))
			])
		)
	};
}

/**
 * Overtime earlier payslips settled, as each limit counted it at settlement: employee id → limit
 * key (`''` the regulated count the monthly funnel reads) → calendar month → hours. Read from the
 * run's frozen trace, never from the lines: an OVERTIME line cannot say whether its day was a rest
 * day, a holiday or an emergency, nor whether a limit's `counts_day_when` held on it.
 */
function priorOvertimeHours(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly traceByRun: ReadonlyMap<string, PayrollTrace>;
}): Map<string, Map<string, Map<string, number>>> {
	const hours = new Map<string, Map<string, Map<string, number>>>();
	for (const payslip of options.payslips) {
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		if (employeeId == null) continue;
		const traced = options.traceByRun
			.get(payslip.payroll_run_id)
			?.find((entry) => entry.employment_id === payslip.employment_id);
		const byLimit = hours.get(employeeId) ?? new Map<string, Map<string, number>>();
		for (const { limit, month, hours: counted } of traced?.overtime_hours ?? []) {
			const byMonth = byLimit.get(limit) ?? new Map<string, number>();
			byMonth.set(month, (byMonth.get(month) ?? 0) + counted);
			byLimit.set(limit, byMonth);
		}
		hours.set(employeeId, byLimit);
	}
	return hours;
}

/** Every in-lieu slice earlier payslips credited or paid, per employee (TW 勞基法 §32-1). */
function priorInLieu(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly traceByRun: ReadonlyMap<string, PayrollTrace>;
}): Map<string, InLieuSlice[]> {
	const slices = new Map<string, InLieuSlice[]>();
	for (const payslip of options.payslips) {
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		if (employeeId == null) continue;
		const traced = options.traceByRun
			.get(payslip.payroll_run_id)
			?.find((entry) => entry.employment_id === payslip.employment_id);
		slices.set(employeeId, [
			...(slices.get(employeeId) ?? []),
			...(traced?.time_off_in_lieu ?? [])
		]);
	}
	return slices;
}

import { refuse } from '../refuse.js';
import {
	assessCompanyContributions,
	assessContributions,
	naming,
	prepareContributionAssessment
} from './contribution.js';
import { contribute } from '../../lib/payroll/run/contribute.js';
import { validateWorkInputs, validateWorkResult } from './work.js';
import { blockers, describeIssues } from '../../lib/payroll/run/validate.js';
import { payProjection, taxYearOf } from '../../lib/payroll/run/period.js';
import { dateKey } from '../iso-day.js';

export function calculateFamilyAssessments(options: {
	readonly configuration: Configuration;
	readonly gathered: GatheredRun;
	readonly window: PayrollWindow;
	readonly period: string;
}) {
	const { configuration, gathered, window, period } = options;
	const issues = validateWorkInputs({ configuration, bundles: gathered.bundles, window, period });
	// A loan whose agreed pay line has no row in the version this run prices under can recover
	// nothing, and recovering nothing quietly is an under-payment nobody sees. Named here, before
	// anyone is measured, for the same reason every other input fault is.
	issues.push(
		...validateLoanRecoveries({
			configuration,
			bundles: gathered.bundles
		})
	);
	if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));
	const measuredRuns: Array<{
		readonly measured: ReturnType<typeof calculateFamilies>;
		readonly termsThrough: string;
		readonly projection: ReturnType<typeof payProjection>;
	}> = [];
	const taxYearStartMonth = configuration.jurisdiction.payroll.tax_year_start_month;

	for (const bundle of gathered.bundles) {
		// 4 — MEASURE
		//
		// On the employment's own cadence: one run settles the instalment its period names for each
		// cadence, and `gather.ts` settled this employment over exactly that window: a half month
		// for semi-monthly terms, the cutoff window for monthly ones, never the run's envelope.
		//
		// The projection counts **payslips**, per cadence. A semi-monthly employment now receives one
		// payslip per half, twenty-four before a January tax year is out; a monthly employment at the
		// same company still receives twelve. `payProjection` also carries how much of a year each
		// payslip stands for, so twenty-four half-month payslips project the same annual income as
		// twelve monthly ones.
		const projection = payProjection(period, taxYearStartMonth, bundle.window);
		const yearEarned = gathered.yearEarned.get(bundle.employment.employee_id) ?? new Map();
		const earnedByMonth = gathered.earnedByMonth.get(bundle.employment.employee_id) ?? new Map();
		const wages = calculateFamilies({
			bundle,
			configuration: atWorksite(
				configuration,
				bundle.termsHistory,
				bundle.workDays,
				bundle.employee
			),
			period,
			salary: bundle.window.salary,
			periodsRemaining: projection.payslipsRemaining,
			headcount: gathered.headcount,
			consumedEntries: gathered.consumedEntries,
			yearEarned,
			earnedByMonth,
			priorOvertimeHours: gathered.priorOvertimeHours.get(bundle.employment.employee_id),
			priorInLieu: gathered.priorInLieu?.get(bundle.employment.employee_id)
		});
		// Deferral moves the wage payment, not insurance coverage. Preserve the employment and
		// calendar measurements, but leave monetary inputs available for the run that pays them.
		const measured: MeasuredEmployment =
			bundle.deferral == null
				? wages
				: {
						...wages,
						base: [],
						adjustments: [],
						proration: [],
						arrears: null,
						componentAmounts: new Map(),
						// A period is deferred only when the hire falls after its attendance window
						// (`startsAfterWindow`), so no day of it can be elected here: every day from the
						// hire on is in the next run's window, which credits the hours it elects and
						// settles their payout (TW 勞基法 §32-1).
						inLieuSlices: [],
						captured: {
							workDays: [],
							payRequests: { CLAIM: [], ADHOC: [] },
							leave: [],
							loanRepayments: [],
							wagePeriods: []
						}
					};

		// What the family measurements said about requests they read and paid nothing for. Warnings:
		// the run is correct, and the operator has to be able to see that the entry was consumed.
		issues.push(...measured.notes);
		issues.push(
			...validateWorkResult({
				configuration,
				measured,
				priorOvertimeHours: gathered.priorOvertimeHours.get(bundle.employment.employee_id)
			})
		);

		measuredRuns.push({
			measured,
			projection,
			// These are committed calculation dates, not the future horizon of an entitlement or tax projection.
			termsThrough: [
				[
					bundle.window.salary.end,
					employmentDates(bundle.employment).exit ?? bundle.window.salary.end
				].toSorted()[0]!,
				[
					bundle.attendance.end,
					employmentDates(bundle.employment).exit ?? bundle.attendance.end
				].toSorted()[0]!,
				...bundle.workDays
					.filter((day) => measured.captured.workDays.includes(day.id))
					.map((day) => dateKey(day.work_date)),
				...measured.captured.leave.flatMap((entry) => entry.charges.map((charge) => charge.date)),
				...bundle.payRequests
					.filter((request) => measured.captured.payRequests[request.family].includes(request.id))
					.map((request) => request.event_date),
				...bundle.loanRepayments
					.filter((repayment) => measured.captured.loanRepayments.includes(repayment.id))
					.map((repayment) => dateKey(repayment.due_date)),
				...measured.proration.map((segment) => segment.to)
			]
				.toSorted()
				.at(-1)!
		});
	}

	// Every measured run is judged before any is accumulated, so a blocker names every person it
	// concerns and an undecided cell is reported as the issue it is rather than thrown from the grid.
	if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));
	/**
	 * One measured slip's contribution assessment, under a version and the history before its period; an EARNED
	 * scheme reads that history with each late line in the period it was earned (`prior.earned`).
	 */
	const assess = (
		measured: MeasuredEmployment,
		version: Configuration,
		prior: Pick<
			GatheredRun,
			| 'yearToDate'
			| 'lastYear'
			| 'firstYear'
			| 'statutoryHistory'
			| 'yearQuantityPayments'
			| 'yearEarned'
			| 'earnedByMonth'
			| 'paidWagesByMonth'
			| 'monthPrior'
			| 'earned'
		>,
		at: string,
		projection: ReturnType<typeof payProjection>
	) => {
		const { bundle } = measured;
		const employeeId = bundle.employment.employee_id;
		const priors = (months: ReadonlyMap<string, MonthPrior>) => ({
			monthPrior: months.get(`${employeeId}:${at.slice(0, 7)}`),
			periodPrior: at === at.slice(0, 7) ? undefined : months.get(`${employeeId}:${at}`)
		});
		const assessed = prepareContributionAssessment({
			measured,
			configuration: version,
			projection,
			yearToDate: prior.yearToDate,
			lastYear: prior.lastYear,
			firstYear: prior.firstYear,
			statutoryHistory: prior.statutoryHistory.get(employeeId) ?? [],
			yearQuantityPayments: prior.yearQuantityPayments?.get(employeeId),
			headcount: gathered.headcount,
			headcountCitizens: gathered.headcountCitizens,
			yearEarned: prior.yearEarned.get(employeeId) ?? new Map(),
			earnedByMonth: prior.earnedByMonth.get(employeeId) ?? new Map(),
			paidWagesByMonth: prior.paidWagesByMonth.get(employeeId) ?? new Map(),
			...priors(prior.monthPrior),
			history: bundle.history,
			company: gathered.company
		});
		const earned = prior.earned;
		return earned == null
			? assessed
			: {
					...assessed,
					calculation: {
						...assessed.calculation,
						earnedView: {
							...priors(earned.monthPrior),
							earnedByMonth: earned.earnedByMonth.get(employeeId) ?? new Map(),
							yearEarned: earned.yearEarned.get(employeeId) ?? new Map()
						}
					}
				};
	};
	const earnedSchemes = new Set(
		configuration.contributions
			.filter((scheme) => scheme.row.late_line_month === 'EARNED')
			.map((scheme) => scheme.row.code)
	);
	const measuredContracts = measuredRuns.map(({ projection, ...run }) => {
		const assessed = assess(run.measured, configuration, gathered, period, projection);
		const late = run.measured.bundle.late;
		const lateMonth = run.measured.lateMonth;
		if (late == null || lateMonth == null || earnedSchemes.size === 0)
			return { ...run, ...assessed };
		// The late lines bill an EARNED scheme in their own period: a top-up of its bill, under its version and
		// history, charged here. Here the scheme bills this slip without them, its month and year counting them as
		// that period's.
		const lateLines = run.measured.adjustments.filter((line) => line.earnedPeriod != null);
		const earnedMonth = assess(
			{ ...lateMonth, bundle: { ...lateMonth.bundle, statutoryFacts: late.statutoryFacts } },
			late.configuration,
			late.prior,
			late.window.period,
			payProjection(
				late.window.period,
				late.configuration.jurisdiction.payroll.tax_year_start_month,
				late.window
			)
		);
		const topUps = new Map(
			naming(run.measured.bundle.employment.employee_number, () =>
				contribute({
					...earnedMonth.calculation,
					accumulation: accumulatePayslip({
						items: lateLines,
						ordinaryHour: lateMonth.ordinaryHourlyRate
					})
				})
			)
				.filter((charge) => earnedSchemes.has(charge.contribution.row.code))
				.map((charge) => [charge.contribution.row.code, charge])
		);
		const calculation = assessed.calculation;
		const view = calculation.earnedView ?? {};
		// Counted in this tax year only when their period is in it.
		const sameYear =
			taxYearOf(late.window.period, configuration.jurisdiction.payroll.tax_year_start_month) ===
			taxYearOf(period, configuration.jurisdiction.payroll.tax_year_start_month);
		const lateEarned = new Map<string, number>();
		for (const [code, amount] of earnedOf(
			[],
			lateLines.map((line) => ({
				component_code: line.catalogueComponent.code,
				bucket: line.bucket,
				amount: line.amount
			}))
		))
			lateEarned.set(code, (lateEarned.get(code) ?? 0) + amount);
		const plus = (into: ReadonlyMap<string, number>) => {
			const out = new Map(into);
			for (const [code, amount] of lateEarned) out.set(code, (out.get(code) ?? 0) + amount);
			return out;
		};
		const lateMonthKey = late.window.period.slice(0, 7);
		const byMonth = view.earnedByMonth ?? calculation.earnedByMonth ?? new Map();
		return {
			...run,
			...assessed,
			calculation: {
				...calculation,
				earnedView: {
					...view,
					accumulation: accumulatePayslip({
						items: [
							...run.measured.base,
							...run.measured.adjustments.filter((line) => line.earnedPeriod == null)
						],
						ordinaryHour: run.measured.ordinaryHourlyRate
					}),
					earnedByMonth: new Map(byMonth).set(
						lateMonthKey,
						plus(byMonth.get(lateMonthKey) ?? new Map())
					),
					...(sameYear
						? {
								yearEarned: plus(view.yearEarned ?? calculation.yearEarned),
								yearToDate: (code: string) => {
									const year = calculation.yearToDate(code);
									const top = topUps.get(code);
									return top == null
										? year
										: {
												employee: year.employee + top.employee,
												employer: year.employer + top.employer,
												base: year.base + top.base,
												ordinary: (year.ordinary ?? 0) + (top.ordinary ?? 0),
												rebate: (year.rebate ?? 0) + (top.rebate ?? 0)
											};
								}
							}
						: {})
				},
				lateTopUps: { period: late.window.period, charges: topUps }
			}
		};
	});

	// 6 — CONTRIBUTE once per person/entity assessment; outputs remain on their own contracts.
	const chargesByEmployment = assessContributions(measuredContracts);
	// A COMPANY-assessed scheme is charged once on the run, over the sum of every payslip, after
	// the employment schemes. It is the employer's own levy and rides on no payslip.
	const companyCharges = assessCompanyContributions({
		configuration,
		gathered,
		window,
		period,
		accumulations: measuredContracts.map(({ calculation }) => calculation.accumulation),
		charges: [...chargesByEmployment.values()].flat(),
		company: gathered.company
	});
	return { measuredContracts, chargesByEmployment, companyCharges, issues };
}
