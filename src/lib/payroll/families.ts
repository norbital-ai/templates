/** Families prepare their own inputs and calculations. This coordinator preserves the family pipeline and contribution staging. */
import { decodeNumber } from '@norbital-ai/std/json';
import type {
	Configuration,
	Jurisdiction
} from '../../collections/payroll_runs/lib/configuration.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import {
	inclusiveDays,
	monthDays,
	monthKey,
	periodMonth,
	requiredDateKey
} from '../../collections/payroll_runs/lib/dates.js';
import type { WorkspaceRow } from '../../collections/payroll_runs/$types.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { type PayCadence, type PayFrequency } from '../../collections/payroll_runs/lib/period.js';
import { calculateLeavePayroll } from '../leave/payroll.js';
import { settle } from '../../collections/payroll_runs/lib/settle.js';
import { employmentDates } from '../../collections/payroll_runs/lib/settlement.js';
import { serviceStart } from '../employment-contract.js';
import type { PayslipProration } from '../../datatypes/payslip_proration/+definition.js';
import type {
	MeasuredEmployment,
	MeasureEmploymentOptions,
	MeasuredBase,
	MeasuredAdjustment
} from './family.js';
import { baseLine, settlementBucket } from './family.js';
import {
	PAY_REQUEST_FAMILIES,
	requestIsDue,
	prepareAllowanceSources,
	prepareAllowanceWork,
	prepareMoneySteps,
	type PayRequest,
	type PayRequestFamily,
	type PreparedPayRequest
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
	const { allowanceWorkDayIds, allowanceWorkingDaysIn } = prepareAllowanceWork({ bundle });

	if (employed == null) {
		const currency = configuration.jurisdiction.payroll.currency;
		const leave = calculateLeavePayroll({
			prepared: bundle.leave,
			window: options.salary,
			dueThrough: options.salary.end,
			currency,
			absenceRate: () => {
				throw new Error('An ended employment cannot acquire new time-off charges in this period.');
			}
		});
		const finalDate = employmentDates(bundle.employment).exit;
		if (finalDate == null) throw new Error('An ended contract requires a final service date.');
		const finalTerms = termsAt(bundle, finalDate);
		const cadence: PayCadence = {
			company: configuration.company,
			payFrequency: bundle.payFrequency
		};
		const requests = bundle.payRequests.filter(
			(request) =>
				!request.recurring &&
				request.materialised == null &&
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
			employment: { service_start: serviceStart(bundle.employment) },
			terms: finalTerms,
			children: bundle.children,
			company: configuration.company,
			asOf: finalDate
		});
		for (const step of prepareMoneySteps({
			bundle,
			configuration,
			salary: options.salary,
			employed: { start: finalDate, end: finalDate },
			contracted: { start: finalDate, end: finalDate },
			requests,
			consumedEntries: options.consumedEntries,
			period: options.period,
			// A late allowance earned over its source month prorates on that month’s working days:
			// the source-month schedule is what `allowanceWorkingDaysIn` resolves, historical terms
			// included. A zero here priced every late allowance on a departed contract at nothing.
			workingDaysIn: (window) => allowanceWorkingDaysIn(monthKey(window.start), window),
			allowanceWorkingDaysIn,
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
				workDays: [...allowanceWorkDayIds],
				payRequests: {
					CLAIM: requests.filter((entry) => entry.family === 'CLAIM').map((entry) => entry.id),
					ALLOWANCE: requests
						.filter((entry) => entry.family === 'ALLOWANCE')
						.map((entry) => entry.id),
					PAYMENT: requests.filter((entry) => entry.family === 'PAYMENT').map((entry) => entry.id)
				},
				leave: leave.captures,
				loanRepayments: repaymentRecoveries.map((recovery) => recovery.input.id),
				materialised: requests.flatMap((request) =>
					request.materialised == null ? [] : [request.materialised]
				)
			},
			arrears: null,
			componentAmounts,
			ordinaryHourlyRate: 0,
			ordinaryDayWage: 0,
			overtimeDays: [],
			calendarMonthOvertimeHours: new Map(),
			currency,
			schedule: new Map()
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
		absenceDayWage,
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
	const periodEntries = bundle.payRequests.filter(
		(request) =>
			(!options.deferredWagesOnly || request.recurring) &&
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
		entryTotalByComponentId
	});
	const { overtimeDays, calendarMonthOvertimeHours, nightShiftHours } = workAttendance;
	const measuredLeave = calculateLeavePayroll({
		prepared: bundle.leave,
		includeMonetary: !options.deferredWagesOnly,
		window: attendance,
		dueThrough: options.salary.end,
		currency,
		absenceRate: work.absenceRate
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
					(entry) => cents(entry.sign * decodeNumber(entry.amount)) === calculatedArrears.amount
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
		salary: options.salary,
		employed: wageDays,
		contracted: employed,
		consumedEntries: options.consumedEntries,
		period: options.period,
		workingDaysIn,
		allowanceWorkingDaysIn,
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
	for (const step of steps) {
		const measured = step.calculate();
		if (measured == null) continue;
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
	const capturedWorkDayIds = [
		...new Set([...allowanceWorkDayIds, ...workAttendance.capturedWorkDayIds])
	];

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
					// A materialised occurrence is created with its pin; only authored sources are pinned.
					periodEntries
						.filter((entry) => entry.family === family && entry.materialised == null)
						.map((entry) => entry.id)
				])
			) as unknown as Record<PayRequestFamily, readonly string[]>,
			leave: measuredLeave.captures,
			loanRepayments: repaymentRecoveries.map((recovery) => recovery.input.id),
			materialised: periodEntries.flatMap((entry) =>
				entry.materialised == null ? [] : [entry.materialised]
			)
		},
		arrears,
		notes,
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
		charges: []
	}).gross;
	return amount <= 0 ? null : { period: owed.period, componentCatalogueId, amount };
}

import { Effect } from 'effect';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import { prepareWorkCatalogue, prepareWorkInputs } from './work.js';
import { workPayItems } from './work-lines.js';
import { prepareMoneyCatalogues, prepareMoneyInputs, prepareMoneyConsumption } from './money.js';
import { prepareLoanCatalogue, prepareLoanPayroll } from './loan.js';
import {
	prepareContributionCatalogue,
	prepareContributionInputs,
	contributionYearToDate
} from './contribution.js';
import { prepareLeaveCatalogue, prepareLeavePayroll } from '../leave/payroll.js';
import type { PayrollReadApi, ReadLog } from '../../collections/payroll_runs/lib/api.js';
import type { PayrollWindow } from '../../collections/payroll_runs/lib/period.js';

export function prepareFamilyCatalogues(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly jurisdiction: Jurisdiction;
	readonly companyId: string;
	readonly windowStart: import('../../collections/payroll_runs/lib/dates.js').IsoDate;
	readonly windowEnd: import('../../collections/payroll_runs/lib/dates.js').IsoDate;
}) {
	return Effect.gen(function* () {
		const catalogue = { api: options.api, settingsId: options.jurisdiction.id };
		const [work, money, loans, contributions, catalogueLeaves] = yield* Effect.all(
			[
				prepareWorkCatalogue(options),
				prepareMoneyCatalogues(catalogue),
				prepareLoanCatalogue(catalogue),
				prepareContributionCatalogue(catalogue),
				prepareLeaveCatalogue(catalogue)
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
	readonly employmentIds: readonly string[];
	readonly period: string;
	readonly asOf: string;
	readonly periodWindow: { readonly start: string; readonly end: string };
}) {
	return Effect.gen(function* () {
		const [leaveByEmployment, money] = yield* Effect.all(
			[prepareLeavePayroll(options), prepareMoneyInputs(options)],
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
		const { allowanceConfigurations, allowanceMonthsByEmployment } =
			yield* prepareAllowanceSources(options);
		const inputOptions = {
			...options,
			employmentIds: options.employments.map((row) => row.id),
			employeeIds: [...new Set(options.employments.map((row) => row.employee_id))],
			allowanceConfigurations,
			allowanceMonthsByEmployment
		};
		const [work, loans, factsByEmployee] = yield* Effect.all(
			[
				prepareWorkInputs(inputOptions),
				prepareLoanPayroll(inputOptions),
				prepareContributionInputs(inputOptions)
			],
			{ concurrency: 'unbounded' }
		);
		return {
			...work,
			...loans,
			factsByEmployee,
			allowanceConfigurations,
			allowanceMonthsByEmployment
		};
	});
}
export function prepareFamilyHistory(
	options: Parameters<typeof contributionYearToDate>[0] & {
		readonly api: PayrollReadApi & { readonly reads: ReadLog };
		/** run id → its period, so a settled payslip's overtime lands in a calendar month. */
		readonly periodByRun: ReadonlyMap<string, string>;
	}
) {
	return Effect.gen(function* () {
		const scope = { api: options.api, payslipIds: options.payslips.map((row) => row.id) };
		const consumedEntries = yield* prepareMoneyConsumption(scope);
		return {
			yearToDate: contributionYearToDate(options),
			priorOvertimeHours: priorOvertimeHours(options),
			consumedEntries
		};
	});
}

/**
 * Regulated overtime hours earlier PAID payslips settled: employee id → calendar month → hours.
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

import { sha256Json } from '@norbital-ai/std/reckon';
import { configurationSnapshot } from '../../collections/payroll_runs/lib/configuration.js';
import { resolveHolidayInputs } from '../holiday-inputs.js';
import type { GatheredRun } from '../../collections/payroll_runs/lib/gather.js';
export function finalizeFamilyConfiguration(
	configuration: Configuration,
	facts: GatheredRun,
	window: PayrollWindow
) {
	const withWorkHolidays = (source: Configuration, period: string): Configuration => {
		if (facts.workHolidayEvidence.inputs.length === 0) return source;
		const resolved = resolveHolidayInputs(
			[
				...new Map(
					[...source.holidaySnapshots, ...facts.workHolidayEvidence.holidays].map((holiday) => [
						holiday.id,
						holiday
					])
				).values()
			],
			source.company.id,
			source.holidayInputs.map((input) => input.date),
			facts.workHolidayEvidence.inputs
		);
		const pinned = {
			...source,
			holidays: resolved.holidays,
			holidaySnapshots: resolved.snapshots,
			holidayInputs: resolved.inputs
		};
		return { ...pinned, hash: sha256Json(configurationSnapshot(pinned, period)) };
	};
	const current = withWorkHolidays(configuration, window.period);
	// Source-month configurations are the run's evidence too: the same work-holiday pins reach them,
	// and their calendars ride the run's holiday snapshot, so a payslip re-reads the days it paid.
	const allowanceSources = new Map(
		facts.bundles.flatMap((bundle) => [...(bundle.allowanceConfigurations ?? [])])
	);
	for (const [month, source] of allowanceSources)
		allowanceSources.set(month, withWorkHolidays(source, month));
	const gathered = {
		...facts,
		bundles: facts.bundles.map((bundle) =>
			bundle.allowanceConfigurations
				? {
						...bundle,
						allowanceConfigurations: new Map(
							[...bundle.allowanceConfigurations.keys()].map((month) => [
								month,
								allowanceSources.get(month)!
							])
						)
					}
				: bundle
		)
	};
	const historicalCalendars = [...allowanceSources.values()].filter(
		(source) => source.work.proration.by === 'WORKING_DAYS'
	);
	const preparedConfiguration =
		allowanceSources.size === 0
			? current
			: {
					...current,
					holidaySnapshots: [
						...new Map(
							[current, ...historicalCalendars]
								.flatMap((source) => source.holidaySnapshots)
								.map((holiday) => [holiday.id, holiday])
						).values()
					],
					holidayInputs: [
						...new Map(
							[current, ...historicalCalendars]
								.flatMap((source) => source.holidayInputs)
								.map((input) => [`${input.company_id}/${input.date}`, input])
						).values()
					],
					hash: sha256Json({
						current: current.hash,
						allowance_sources: [...allowanceSources]
							.map(([month, source]) => [month, source.hash])
							.sort(([left], [right]) => String(left).localeCompare(String(right)))
					})
				};
	return { configuration: preparedConfiguration, gathered };
}

import { refuse } from '@norbital-ai/bolt/authoring';
import { assessContributions, prepareContributionAssessment } from './contribution.js';
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
		const measured = calculateFamilies({
			bundle,
			configuration,
			period,
			salary: bundle.window.salary,
			periodsRemaining: projection.payslipsRemaining,
			headcount: gathered.headcount,
			consumedEntries: gathered.consumedEntries
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
	const measuredContracts = measuredRuns.map(({ projection, ...run }) => ({
		...run,
		...prepareContributionAssessment({
			measured: run.measured,
			configuration,
			projection,
			yearToDate: gathered.yearToDate,
			headcount: gathered.headcount
		})
	}));

	// 6 — CONTRIBUTE once per person/entity assessment; outputs remain on their own contracts.
	const chargesByEmployment = assessContributions(measuredContracts);
	return { measuredContracts, chargesByEmployment, issues };
}
