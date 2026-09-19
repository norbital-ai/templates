/** Families prepare their own inputs and calculations. This coordinator preserves the family pipeline and contribution staging. */
import { decodeNumber } from '@norbital-ai/std/json';
import type {
	CatalogueComponent,
	Configuration,
	Jurisdiction
} from '../../collections/payroll_runs/lib/configuration.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import {
	accumulateSettledPayslip,
	sumAccumulations,
	type AccumulatedPayslip,
	type MonthPrior
} from '../../collections/payroll_runs/lib/accumulate.js';
import {
	inclusiveDays,
	completedMonths,
	addDays,
	monthDays,
	monthKey,
	periodMonth,
	requiredDateKey
} from '../../collections/payroll_runs/lib/dates.js';
import type { WorkspaceRow } from '../../collections/payroll_runs/$types.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import {
	closesTaxYear,
	taxYearBounds,
	type PayCadence,
	type PayFrequency
} from '../../collections/payroll_runs/lib/period.js';
import { calculateLeavePayroll, unpaidLeaveDays } from '../leave/payroll.js';
import { settle } from '../../collections/payroll_runs/lib/settle.js';
import { employmentDates } from '../../collections/payroll_runs/lib/settlement.js';
import { stint } from '../employment-contract.js';
import type { PayslipProration } from '../../datatypes/payslip_proration/+definition.js';
import type {
	MeasuredEmployment,
	MeasureEmploymentOptions,
	YearContext,
	MeasuredBase,
	MeasuredAdjustment
} from './family.js';
import { baseLine, settlementBucket } from './family.js';
import {
	PAY_REQUEST_FAMILIES,
	requestIsDue,
	prepareMoneySteps,
	type PayRequestFamily,
	type PreparedPayRequest,
	type MaterialisedMoney
} from './money.js';
import { prepareWorkContext, calculateWorkAttendance, prepareWorkSteps, termsAt } from './work.js';
import { measureLoanRecoveries, validateLoanRecoveries } from './loan.js';
import type { RunIssue } from '../../collections/payroll_runs/lib/validate.js';
export function calculateFamilies(options: MeasureEmploymentOptions): MeasuredEmployment {
	/** What the family measurements reported about the requests they read and did not pay. */
	const notes: RunIssue[] = [];
	const { bundle } = options;
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
		const finalDate = employmentDates(bundle.employment).exit;
		if (finalDate == null) throw new Error('An ended contract requires a final service date.');
		// An ended contract acquires no new time off, but it can still settle an encashment agreed
		// before the exit; that money prices at the ordinary day wage the Work context resolves,
		// and the resolution is deferred to the run that actually settles one.
		const leave = calculateLeavePayroll({
			prepared: bundle.leave,
			window: options.salary,
			dueThrough: options.salary.end,
			currency,
			absenceRate: () => {
				throw new Error('An ended employment cannot acquire new time-off charges in this period.');
			},
			ordinaryDayRate: () =>
				prepareWorkContext({
					bundle,
					configuration,
					salary: options.salary,
					employed: { start: finalDate, end: finalDate }
				}).dayWage
		});
		const finalTerms = termsAt(bundle, finalDate);
		const cadence: PayCadence = {
			company: configuration.company,
			payFrequency: bundle.payFrequency
		};
		// An ended contract settles the claims it still owes; a standing allowance ended with it.
		const requests = bundle.payRequests.filter(
			(request) =>
				request.window == null &&
				requestIsDue(
					request,
					options.period,
					options.salary,
					decodeNumber(configuration.company.pay_cutoff_day),
					cadence
				)
		);

		const componentAmounts = new Map<string, number>();
		const adjustments: MeasuredAdjustment[] = [...leave.adjustments];
		const subject = personContext({
			employee: bundle.employee,
			employment: stint(bundle.employment),
			fixedAllowances: fixedAllowancesOn(bundle.payRequests, finalDate),
			monthlyWage6mAverage: monthlyWageAverage(bundle, finalDate, 6),
			terms: finalTerms,
			children: bundle.children,
			company: configuration.company,
			asOf: finalDate
		});
		for (const step of prepareMoneySteps({
			bundle,
			configuration,
			year: () => yearContextOf({ bundle, configuration, options, componentAmounts }),
			salary: options.salary,
			employed: { start: finalDate, end: finalDate },
			contracted: { start: finalDate, end: finalDate },
			requests,
			consumedEntries: options.consumedEntries,
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
			cutoffDay: decodeNumber(configuration.company.pay_cutoff_day),
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
					ADHOC: requests.filter((entry) => entry.family === 'ADHOC').map((entry) => entry.id),
					ALLOWANCE: []
				},
				leave: leave.captures,
				loanRepayments: repaymentRecoveries.map((recovery) => recovery.input.id),
				materialised: []
			},
			arrears: null,
			componentAmounts,
			ordinaryHourlyRate: 0,
			ordinaryDayWage: 0,
			overtimeDays: [],
			calendarMonthOvertimeHours: new Map(),
			calendarMonthAllOvertimeHours: new Map(),
			unpricedWeeks: [],
			currency,
			schedule: new Map(),
			limits: [],
			periodWorkingDays: 0,
			periodUnpaidDays: 0,
			week: { ordinary_hours_per_week: 0, working_days_per_week: 0 }
		};
	}
	const work = prepareWorkContext({ bundle, configuration, salary: options.salary, employed });
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
	const cutoffDay = decodeNumber(configuration.company.pay_cutoff_day);
	// The default pay period is answered in the grammar this employment is paid in: a half at a
	// semi-monthly company for semi-monthly terms, the `-2` run there for monthly terms, the month
	// everywhere else. See `defaultPayPeriod`.
	const cadence: PayCadence = {
		company: configuration.company,
		payFrequency: rateTerms.pay_frequency
	};
	// A deferred period's wages are the salary and the standing allowances; the claims that settled
	// there are settled once, by the run that pays them.
	const periodEntries = bundle.payRequests.filter(
		(request) =>
			(!options.deferredWagesOnly || request.window != null) &&
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
		priorOvertimeHours: options.priorOvertimeHours
	});
	const {
		overtimeDays,
		calendarMonthOvertimeHours,
		calendarMonthAllOvertimeHours,
		nightShiftHours,
		unpricedWeeks
	} = workAttendance;
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
	const measuredLeave = calculateLeavePayroll({
		prepared: bundle.leave,
		includeMonetary: !options.deferredWagesOnly,
		window: attendance,
		dueThrough: options.salary.end,
		currency,
		absenceRate: work.absenceRate,
		// An encashed day is paid at the ordinary day — the month over the version's ordinary
		// divisor (SG EA: the gross rate of pay for a day; MY s.60E(3B): the ordinary rate; PH:
		// the daily wage) — not at the absence day, which is the month over its own working days.
		ordinaryDayRate: () => dayWage
	});

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
	const stepOptions = {
		bundle,
		configuration,
		year: () => yearContextOf({ bundle, configuration, options, componentAmounts }),
		salary: options.salary,
		employed: wageDays,
		contracted: employed,
		consumedEntries: options.consumedEntries,
		period: options.period,
		workingDaysIn,
		unpaidDaysIn,
		instalments: rateTerms.pay_frequency === 'SEMI_MONTHLY' ? 2 : 1,
		rates: { ordinaryDay: dayWage, ordinaryHour: hourlyRate },
		subject,
		note: (issue: RunIssue) => notes.push(issue)
	};
	const steps = [
		...prepareWorkSteps(stepOptions),
		// The requests arrive in query order; their code is the inferred, deterministic order.
		...prepareMoneySteps({ ...stepOptions, requests: periodEntries }).toSorted((a, b) =>
			a.item.code === b.item.code
				? a.item.id.localeCompare(b.item.id)
				: a.item.code.localeCompare(b.item.code)
		)
	];
	const materialised: MaterialisedMoney[] = [];
	for (const step of steps) {
		const measured = step.calculate();
		if (measured == null) continue;
		if (measured.allowanceEntry != null) materialised.push(measured.allowanceEntry);
		const component = step.item;
		const running = (componentAmounts.get(component.code) ?? 0) + measured.amount;
		componentAmounts.set(component.code, running);
		if (settlementBucket(component.destination, component.direction) === 'INFORMATION') continue;
		base.push(...measured.base);
		proration.push(...measured.proration);
		adjustments.push(...measured.adjustments);
	}

	adjustments.push(...workAttendance.adjustments);

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

	return {
		bundle,
		base,
		proration,
		adjustments,
		captured: {
			workDays: capturedWorkDayIds,
			payRequests: Object.fromEntries(
				PAY_REQUEST_FAMILIES.map((family) => [
					family,
					// An allowance entry is created with its pin; only authored claims are pinned.
					periodEntries
						.filter((entry) => entry.family === family && entry.window == null)
						.map((entry) => entry.id)
				])
			) as unknown as Record<PayRequestFamily, readonly string[]>,
			leave: measuredLeave.captures,
			loanRepayments: repaymentRecoveries.map((recovery) => recovery.input.id),
			materialised
		},
		arrears,
		notes,
		componentAmounts,
		ordinaryHourlyRate: hourlyRate,
		ordinaryDayWage: dayWage,
		overtimeDays,
		calendarMonthOvertimeHours,
		calendarMonthAllOvertimeHours,
		unpricedWeeks,
		currency,
		schedule,
		limits: workAttendance.limits,
		periodWorkingDays: subject.period.working_days,
		periodUnpaidDays: unpaidDaysIn(options.salary),
		week: {
			ordinary_hours_per_week: rateTerms.ordinary_hours_per_week,
			working_days_per_week: rateTerms.working_days_per_week
		}
	};
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
	// The deferred period's **gross**, by SETTLE's own definition of it and not a second one. What is
	// owed for a month is what that month's payslip would have said was earned; charging statutory
	// on it is this run's job, on this run's combined wage, which is what the source system does.
	const amount = settle({
		base: measured.base,
		adjustments: measured.adjustments,
		charges: [],
		currency: measured.currency
	}).gross;
	return amount <= 0 ? null : { period: owed.period, componentCatalogueId, amount };
}

import { Effect } from 'effect';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import type { GatheredRun } from '../../collections/payroll_runs/lib/gather.js';
import { prepareWorkCatalogue, prepareWorkInputs } from './work.js';
import { workPayItems } from './work-lines.js';
import {
	fixedAllowancesOn,
	prepareMoneyCatalogues,
	prepareMoneyInputs,
	prepareMoneyConsumption
} from './money.js';
import { prepareLoanCatalogue, prepareLoanPayroll } from './loan.js';
import {
	prepareContributionCatalogue,
	prepareContributionInputs,
	contributionYearToDate,
	monthlyWageAverage
} from './contribution.js';
import { prepareLeaveCatalogue, prepareLeavePayroll } from '../leave/payroll.js';
import type { PayrollReadApi, ReadLog } from '../../collections/payroll_runs/lib/api.js';
import type { PayrollWindow } from '../../collections/payroll_runs/lib/period.js';

/**
 * A version's catalogues, read once per invocation.
 *
 * A run picks its own configuration and one more for every earlier month a late allowance came
 * from; a February run with December and January stragglers read the same sealed version's
 * statutory rules — three megabytes of Third Schedule bands — three times, and decoding them was
 * the single largest cost in the guest. The four version-only catalogues are keyed by the settings
 * version id for the life of the runtime `db` object, which is one invocation; the work catalogue stays
 * per call because it reads the window's shifts and holidays.
 */
const runMoneyCatalogues = (catalogue: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly settingsId: string;
}) =>
	Effect.all(
		[
			prepareMoneyCatalogues(catalogue),
			prepareLoanCatalogue(catalogue),
			prepareContributionCatalogue(catalogue),
			prepareLeaveCatalogue(catalogue)
		],
		{ concurrency: 'unbounded' }
	);
type VersionCatalogues = Effect.Success<ReturnType<typeof runMoneyCatalogues>>;
const versionCataloguesByApi = new WeakMap<object, Map<string, VersionCatalogues>>();

export function prepareFamilyCatalogues(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly jurisdiction: Jurisdiction;
	readonly companyId: string;
	readonly windowStart: import('../../collections/payroll_runs/lib/dates.js').IsoDate;
	readonly windowEnd: import('../../collections/payroll_runs/lib/dates.js').IsoDate;
	readonly shiftRows: Parameters<typeof prepareWorkCatalogue>[0]['shiftRows'];
	readonly patternRows: Parameters<typeof prepareWorkCatalogue>[0]['patternRows'];
}) {
	return Effect.gen(function* () {
		const catalogue = { api: options.api, settingsId: options.jurisdiction.id };
		// Keyed by the runtime's own `db`, which every read-log wrapper spreads unchanged; the
		// wrappers themselves are a fresh object per phase.
		const cache =
			versionCataloguesByApi.get(options.api.db) ??
			(() => {
				const fresh = new Map<string, VersionCatalogues>();
				versionCataloguesByApi.set(options.api.db, fresh);
				return fresh;
			})();
		const cached = cache.get(options.jurisdiction.id);
		const [work, [money, loans, contributions, catalogueLeaves]] = yield* Effect.all(
			[
				prepareWorkCatalogue(options),
				cached === undefined
					? Effect.tap(runMoneyCatalogues(catalogue), (loaded) =>
							Effect.sync(() => cache.set(options.jurisdiction.id, loaded))
						)
					: Effect.succeed(cached)
			],
			{ concurrency: 'unbounded' }
		);
		return {
			...work,
			contributions,
			catalogueLeaves,
			catalogueComponents: [...workPayItems(work.work), ...money, ...loans].toSorted((a, b) =>
				a.code === b.code ? a.id.localeCompare(b.id) : a.code.localeCompare(b.code)
			)
		};
	});
}
export function prepareFamilyObligations(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: Configuration;
	readonly employments: readonly { readonly id: string }[];
	readonly period: string;
	readonly asOf: string;
	readonly periodWindow: { readonly start: string; readonly end: string };
}) {
	return Effect.gen(function* () {
		const [leaveByEmployment, money] = yield* Effect.all(
			[
				prepareLeavePayroll({
					api: options.api,
					employments: options.employments,
					versions: options.configuration.lineageVersions,
					currency: options.configuration.jurisdiction.payroll.currency
				}),
				prepareMoneyInputs({
					...options,
					employmentIds: options.employments.map((row) => row.id)
				})
			],
			{ concurrency: 'unbounded' }
		);
		return { leaveByEmployment, requestsByEmployment: money.requestsByEmployment };
	});
}
export function prepareFamilyInputs(
	options: Omit<Parameters<typeof prepareMoneyInputs>[0], 'employmentIds'> & {
		readonly employments: readonly { readonly id: string; readonly employee_id: string }[];
		readonly requestsByEmployment: ReadonlyMap<string, readonly PreparedPayRequest[]>;
		readonly cadenceByEmployment: ReadonlyMap<
			string,
			{ readonly window: PayrollWindow; readonly payFrequency: PayFrequency }
		>;
		readonly window: PayrollWindow;
		readonly complianceSpan: PayrollWindow['attendance'];
	} & Omit<Parameters<typeof prepareLoanPayroll>[0], 'employmentIds' | 'employments'>
) {
	return Effect.gen(function* () {
		const inputOptions = {
			...options,
			employmentIds: options.employments.map((row) => row.id),
			employeeIds: [...new Set(options.employments.map((row) => row.employee_id))]
		};
		const [work, loans, factsByEmployee] = yield* Effect.all(
			[
				prepareWorkInputs(inputOptions),
				prepareLoanPayroll(inputOptions),
				prepareContributionInputs(inputOptions)
			],
			{ concurrency: 'unbounded' }
		);
		return { ...work, ...loans, factsByEmployee };
	});
}
/**
 * The earlier instalments of each calendar month, per employee: what they settled (re-folded into
 * an accumulation) and what each scheme charged on them. A MONTH-assessed scheme at a
 * semi-monthly or weekly cadence prices the month on the sum and charges the difference.
 */
function monthPriorOf(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly periodByRun: ReadonlyMap<string, string>;
	readonly catalogueComponents?: readonly CatalogueComponent[];
}): Map<string, MonthPrior> {
	const componentsByCode = new Map(
		(options.catalogueComponents ?? []).map((component) => [component.code, component])
	);
	const parts = new Map<
		string,
		{
			accumulations: AccumulatedPayslip[];
			charged: Map<string, { employee: number; employer: number; base: number; ordinary: number }>;
		}
	>();
	for (const payslip of options.payslips) {
		const period = options.periodByRun.get(payslip.payroll_run_id);
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		if (period == null || employeeId == null) continue;
		const key = `${employeeId}:${period.slice(0, 7)}`;
		const entry = parts.get(key) ?? {
			accumulations: [] as AccumulatedPayslip[],
			charged: new Map<
				string,
				{ employee: number; employer: number; base: number; ordinary: number }
			>()
		};
		entry.accumulations.push(accumulateSettledPayslip(payslip, componentsByCode));
		for (const charge of payslip.statutory) {
			const running = entry.charged.get(charge.scheme_code) ?? {
				employee: 0,
				employer: 0,
				base: 0,
				ordinary: 0
			};
			entry.charged.set(charge.scheme_code, {
				employee: running.employee + decodeNumber(charge.employee_amount),
				employer: running.employer + decodeNumber(charge.employer_amount),
				base: running.base + decodeNumber(charge.base_amount),
				ordinary: running.ordinary + decodeNumber(charge.ordinary_amount ?? 0)
			});
		}
		parts.set(key, entry);
	}
	return new Map(
		[...parts].map(([key, entry]) => [
			key,
			{ accumulation: sumAccumulations(entry.accumulations), charged: entry.charged }
		])
	);
}

export function prepareFamilyHistory(
	options: Parameters<typeof contributionYearToDate>[0] & {
		readonly api: PayrollReadApi & { readonly reads: ReadLog };
		/** run id → its period, so a settled payslip's overtime lands in a calendar month. */
		readonly periodByRun: ReadonlyMap<string, string>;
		readonly catalogueComponents?: readonly CatalogueComponent[];
	}
) {
	return Effect.gen(function* () {
		const scope = { api: options.api, payslipIds: options.payslips.map((row) => row.id) };
		const consumedEntries = yield* prepareMoneyConsumption(scope);
		return {
			yearToDate: contributionYearToDate(options),
			yearEarned: earnedYearToDate(options),
			earnedByMonth: earnedByMonth(options),
			priorOvertimeHours: priorOvertimeHours(options),
			monthPrior: monthPriorOf(options),
			consumedEntries
		};
	});
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
		for (const line of payslip.base)
			byCode.set(
				line.component_code,
				(byCode.get(line.component_code) ?? 0) + decodeNumber(line.amount)
			);
		for (const line of payslip.adjustments)
			if (line.bucket === 'EARNING' || line.bucket === 'NON_WAGE_PAYMENT')
				byCode.set(
					line.component_code,
					(byCode.get(line.component_code) ?? 0) + decodeNumber(line.amount)
				);
		earned.set(employeeId, byCode);
	}
	return earned;
}

/**
 * What each employee's earlier payslips earned, by calendar month and component code — every
 * prior run, not the tax year alone: `earned_average(code, months_back, months)` reads a window
 * of it (TW 勞保條例施行細則 §27: the three months before the February and August declarations).
 */
function earnedByMonth(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly periodByRun: ReadonlyMap<string, string>;
}): Map<string, Map<string, Map<string, number>>> {
	const earned = new Map<string, Map<string, Map<string, number>>>();
	for (const payslip of options.payslips) {
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		const month = options.periodByRun.get(payslip.payroll_run_id)?.slice(0, 7);
		if (employeeId == null || month == null) continue;
		const byMonth = earned.get(employeeId) ?? new Map<string, Map<string, number>>();
		const byCode = byMonth.get(month) ?? new Map<string, number>();
		for (const line of payslip.base)
			byCode.set(
				line.component_code,
				(byCode.get(line.component_code) ?? 0) + decodeNumber(line.amount)
			);
		for (const line of payslip.adjustments)
			if (line.bucket === 'EARNING' || line.bucket === 'NON_WAGE_PAYMENT') {
				byCode.set(
					line.component_code,
					(byCode.get(line.component_code) ?? 0) + decodeNumber(line.amount)
				);
				// Every priced work-day line — overtime, night, the funnelled hours — is also filed
				// under the reserved name, so `earned_average(["BASIC", "OVERTIME"], …)` reads a
				// month's 工資 whole (TW 施行細則 §27).
				if (line.family === 'WORK_DAY')
					byCode.set('OVERTIME', (byCode.get('OVERTIME') ?? 0) + decodeNumber(line.amount));
			}
		byMonth.set(month, byCode);
		earned.set(employeeId, byMonth);
	}
	return earned;
}

/** The year axis of one employment in one run; `earned` reads this run's own lines as they land. */
function yearContextOf(input: {
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly options: Pick<MeasureEmploymentOptions, 'period' | 'salary' | 'yearEarned'>;
	readonly componentAmounts: ReadonlyMap<string, number>;
}): YearContext {
	const { bundle, configuration, options, componentAmounts } = input;
	const startMonth = decodeNumber(configuration.jurisdiction.payroll.tax_year_start_month);
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
			[...new Set(['BASIC', ...options.yearEarned.keys(), ...componentAmounts.keys()])].map(
				(code) => [code, (options.yearEarned.get(code) ?? 0) + (componentAmounts.get(code) ?? 0)]
			)
		)
	};
}

/**
 * Regulated overtime hours earlier payslips settled: employee id → calendar month → hours.
 * Regulated is ordinary/off-day overtime — the same counter the monthly ceiling reads — identified
 * by the OVERTIME line the band carries. Rest-day and holiday work is outside every hours ceiling.
 */
function priorOvertimeHours(options: {
	readonly payslips: readonly WorkspaceRow<'payslips'>[];
	readonly employmentToEmployee: ReadonlyMap<string, string>;
	readonly periodByRun: ReadonlyMap<string, string>;
}): Map<string, Map<string, number>> {
	const hours = new Map<string, Map<string, number>>();
	for (const payslip of options.payslips) {
		const employeeId = options.employmentToEmployee.get(payslip.employment_id);
		const period = options.periodByRun.get(payslip.payroll_run_id);
		if (employeeId == null || period == null) continue;
		const month = periodMonth(period);
		for (const line of payslip.adjustments) {
			const key = line.statutory_rule_key ?? '';
			if (line.family !== 'WORK_DAY' || !key.startsWith('OVERTIME:')) continue;
			const byMonth = hours.get(employeeId) ?? new Map<string, number>();
			byMonth.set(month, (byMonth.get(month) ?? 0) + decodeNumber(line.quantity ?? 0));
			hours.set(employeeId, byMonth);
		}
	}
	return hours;
}

import { refuse } from '@norbital-ai/bolt/authoring';
import {
	assessCompanyContributions,
	assessContributions,
	prepareContributionAssessment
} from './contribution.js';
import { validateWorkInputs, validateWorkResult } from './work.js';
import { blockers, describeIssues } from '../../collections/payroll_runs/lib/validate.js';
import { payProjection } from '../../collections/payroll_runs/lib/period.js';
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
		readonly yearEarned: ReadonlyMap<string, number>;
		readonly earnedByMonth: ReadonlyMap<string, ReadonlyMap<string, number>>;
	}> = [];
	const taxYearStartMonth = decodeNumber(configuration.jurisdiction.payroll.tax_year_start_month);

	for (const bundle of gathered.bundles) {
		// A skipped joining period is skipped: no payslip, no lines, no statutory charge. The days it
		// covers are not lost — the next run derives them from this employment's own contract, which
		// is why nothing has to be handed over here for that to work.
		if (bundle.deferral != null) continue;

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
		const measured = calculateFamilies({
			bundle,
			configuration,
			period,
			salary: bundle.window.salary,
			periodsRemaining: projection.payslipsRemaining,
			headcount: gathered.headcount,
			consumedEntries: gathered.consumedEntries,
			yearEarned,
			priorOvertimeHours: gathered.priorOvertimeHours.get(bundle.employment.employee_id)
		});

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
			yearEarned,
			earnedByMonth,
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
	const measuredContracts = measuredRuns.map(
		({ projection, yearEarned, earnedByMonth, ...run }) => ({
			...run,
			...prepareContributionAssessment({
				measured: run.measured,
				configuration,
				projection,
				yearToDate: gathered.yearToDate,
				headcount: gathered.headcount,
				headcountCitizens: gathered.headcountCitizens,
				yearEarned,
				earnedByMonth,
				monthPrior: gathered.monthPrior.get(
					`${run.measured.bundle.employment.employee_id}:${period.slice(0, 7)}`
				)
			})
		})
	);

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
		charges: [...chargesByEmployment.values()].flat()
	});
	return { measuredContracts, chargesByEmployment, companyCharges, issues };
}
