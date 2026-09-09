/** Families prepare their own inputs and calculations. This coordinator preserves cross-family sequence and contribution staging. */
import { decodeNumber } from '@norbital-ai/std/json';
import type {
	Configuration,
	Jurisdiction
} from '../../collections/payroll_runs/lib/configuration.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import {
	inclusiveDays,
	monthDays,
	requiredDateKey
} from '../../collections/payroll_runs/lib/dates.js';
import { coversDate } from '../../collections/payroll_runs/lib/effective.js';
import { personContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { type PayCadence } from '../../collections/payroll_runs/lib/period.js';
import type { FormulaContext } from '../../collections/payroll_runs/lib/formula.js';
import { calculateLeavePayroll, leaveCoverage } from '../leave/payroll.js';
import { prorationFraction } from '../../collections/payroll_runs/lib/proration.js';
import { normalDailyHours } from '../../collections/payroll_runs/lib/schedule.js';
import { settle } from '../../collections/payroll_runs/lib/settle.js';
import { employmentDates } from '../../collections/payroll_runs/lib/settlement.js';
import type { PayslipProration } from '../../datatypes/payslip_proration/+definition.js';
import type {
	MeasuredEmployment,
	MeasureEmploymentOptions,
	MeasuredBase,
	MeasuredAdjustment
} from './family.js';
import {
	PAY_REQUEST_FAMILIES,
	requestIsDue,
	prepareAllowanceWork,
	prepareMoneySteps,
	type PayRequest,
	type PayRequestFamily
} from './money.js';
import { prepareWorkContext, calculateWorkAttendance, prepareWorkSteps, termsAt } from './work.js';
import { measureLoanRecoveries } from './loan.js';
export function calculateFamilies(options: MeasureEmploymentOptions): MeasuredEmployment {
	const { bundle } = options;
	const sourceComponents = new Map(
		options.configuration.catalogueComponents.map((component) => [component.id, component])
	);
	for (const request of bundle.payRequests)
		sourceComponents.set(request.catalogueComponent.id, request.catalogueComponent);
	const configuration = {
		...options.configuration,
		catalogueComponents: [...sourceComponents.values()].toSorted(
			(left, right) => left.sequence - right.sequence
		)
	};
	// The attendance window is the employment's, not the run's: a leaver settling in their final
	// period is measured to the exit date, because no later run will ever read those days.
	const attendance = bundle.attendance;
	const employed = bundle.employedDays;
	const { allowanceWorkDayIds, allowanceWorkingDaysIn } = prepareAllowanceWork({ bundle });

	if (employed == null) {
		const currency = configuration.jurisdiction.currency;
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
		const components: Record<string, number> = {};
		const entries: Record<string, number> = {};
		for (const component of configuration.catalogueComponents) {
			components[component.code] = 0;
			entries[component.code] =
				(entries[component.code] ?? 0) +
				requests
					.filter((request) => request.component_catalogue_id === component.id)
					.reduce((sum, request) => sum + request.sign * decodeNumber(request.amount), 0);
		}
		for (const item of leave.adjustments) {
			const total = (componentAmounts.get(item.label) ?? 0) + item.amount;
			componentAmounts.set(item.label, total);
			components[item.label] = total;
		}
		const subject = personContext({
			employee: bundle.employee,
			employment: bundle.employment,
			terms: finalTerms,
			children: bundle.children,
			asOf: finalDate
		});
		const facts: Record<string, string | number | boolean> = {};
		for (const contribution of configuration.contributions) {
			const status = bundle.statutoryFacts.find(
				(fact) =>
					fact.statutory_contribution_id === contribution.row.id &&
					coversDate(fact.effective_range, finalDate)
			)?.status;
			facts[`${contribution.row.code}.registered`] = status == null || status.kind === 'REGISTERED';
			facts[`${contribution.row.code}.reference_number`] =
				status?.kind === 'REGISTERED' ? status.reference_number : '';
			facts[`${contribution.row.code}.rate_override`] =
				status?.kind === 'REGISTERED' ? (status.rate_override ?? -1) : -1;
			facts[`${contribution.row.code}.reason`] =
				status?.kind === 'NOT_REGISTERED' ? status.reason : '';
		}
		const context = (): FormulaContext => ({
			components,
			entries,
			facts,
			leaveDays: Object.fromEntries(configuration.catalogueLeaves.map((row) => [row.code, 0])),
			leaveBalances: bundle.leave.balances,
			terms: {
				base_salary: decodeNumber(finalTerms.base_salary.value),
				currency,
				pay_frequency: finalTerms.pay_frequency,
				ordinary_hours_per_week: 0,
				working_days_per_week: 0,
				work_classification: finalTerms.work_classification ?? '',
				employment_type: finalTerms.employment_type ?? '',
				rest_day: ''
			},
			derived: {
				service_months: subject.employment.service_months,
				age: bundle.age ?? -1,
				employed_days: 0,
				headcount: options.headcount,
				ordinary_hourly_rate: 0,
				normal_daily_hours: 0,
				night_shift_hours: 0,
				ordinary_day_wage: 0,
				absence_day_wage: 0
			},
			period: {
				start: options.salary.start,
				end: options.salary.end,
				calendar_days: monthDays(options.salary.start),
				working_days: 0,
				periods_remaining: options.periodsRemaining,
				pay_fraction: 0
			},
			jurisdiction: {
				code: configuration.jurisdiction.code,
				currency,
				ordinary_rate_per: configuration.work.ordinary_rate?.per ?? '',
				ordinary_rate_divisor: decodeNumber(configuration.work.ordinary_rate?.divisor)
			}
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
			workingDaysIn: () => 0,
			allowanceWorkingDaysIn,
			context,
			subject
		})) {
			const measured = step.calculate();
			if (measured == null) continue;
			const total = (componentAmounts.get(step.item.code) ?? 0) + measured.amount;
			componentAmounts.set(step.item.code, total);
			components[step.item.code] = total;
			adjustments.push(...measured.adjustments);
		}

		const repaymentRecoveries = measureLoanRecoveries({
			bundle,
			configuration,
			period: options.period,
			cutoffDay: decodeNumber(configuration.company.pay_cutoff_day),
			cadence,
			subject,
			consumedRepayments: options.consumedRepayments
		});
		for (const recovery of repaymentRecoveries) {
			const total = (componentAmounts.get(recovery.label) ?? 0) + recovery.amount;
			componentAmounts.set(recovery.label, total);
			components[recovery.label] = total;
			adjustments.push(recovery);
		}
		return {
			bundle,
			base: [],
			proration: [],
			adjustments,
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
				loanRepayments: repaymentRecoveries.map((recovery) => recovery.input.id)
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
	const entriesByComponent = new Map<string, PayRequest[]>();
	for (const entry of periodEntries) {
		const bucket = entriesByComponent.get(entry.component_catalogue_id);
		if (bucket) bucket.push(entry);
		else entriesByComponent.set(entry.component_catalogue_id, [entry]);
	}
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
	const componentsByCode: Record<string, number> = {};
	// `entry(CODE)` is the formula vocabulary and it is unchanged: an entry is what a person or HR
	// raised against a component this period, which is exactly what the word always meant.
	const entryTotals: Record<string, number> = {};
	for (const component of configuration.catalogueComponents) {
		componentsByCode[component.code] = 0;
		entryTotals[component.code] =
			(entryTotals[component.code] ?? 0) + (entryTotalByComponentId.get(component.id) ?? 0);
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
	const leaveDays = Object.fromEntries(configuration.catalogueLeaves.map((row) => [row.code, 0]));
	Object.assign(leaveDays, leaveCoverage(bundle.leave, attendance).byCode);
	const leaveBalances = bundle.leave.balances;
	const periodCalendarDays = monthDays(options.salary.start);
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
				work: configuration.work,
				period: options.salary,
				covered: wageDays,
				workingDaysIn
			})
		},
		jurisdiction: {
			code: configuration.jurisdiction.code,
			currency: configuration.jurisdiction.currency,
			ordinary_rate_per: configuration.work.ordinary_rate?.per ?? '',
			ordinary_rate_divisor: decodeNumber(configuration.work.ordinary_rate?.divisor)
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

	// ── walk the catalogue in component sequence ───────────────────────────────────────────────
	const base: MeasuredBase[] = [];
	const proration: PayslipProration[] = [];
	const adjustments: MeasuredAdjustment[] = [];
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
		// and it rides the wage's own component: a second base line under the same code, which the
		// formula context and every total sum.
		base.push({
			catalogueComponent: component,
			nature: component.policy?.kind ?? null,
			label: component.code,
			amount: arrears.amount,
			entry: { component_code: component.code, amount: arrears.amount }
		});
		componentAmounts.set(component.code, arrears.amount);
		componentsByCode[component.code] = arrears.amount;
	}
	const leaveRemaining = [...measuredLeave.adjustments].sort(
		(a, b) => a.catalogueComponent.sequence - b.catalogueComponent.sequence
	);
	const addLeaveThrough = (sequence: number) => {
		while (leaveRemaining[0] != null && leaveRemaining[0].catalogueComponent.sequence <= sequence) {
			const item = leaveRemaining.shift()!;
			const running = (componentAmounts.get(item.label) ?? 0) + item.amount;
			componentAmounts.set(item.label, running);
			componentsByCode[item.label] = running;
			adjustments.push(item);
		}
	};
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
		context,
		subject
	};
	const steps = [
		...prepareWorkSteps(stepOptions),
		...prepareMoneySteps({ ...stepOptions, requests: periodEntries })
	].toSorted((a, b) => a.item.sequence - b.item.sequence);
	for (const step of steps) {
		addLeaveThrough(step.item.sequence);
		const measured = step.calculate();
		if (measured == null) continue;
		const component = step.item;
		const running = (componentAmounts.get(component.code) ?? 0) + measured.amount;
		componentAmounts.set(component.code, running);
		componentsByCode[component.code] = running;
		if (component.nature === 'INFORMATION') continue;
		base.push(...measured.base);
		proration.push(...measured.proration);
		adjustments.push(...measured.adjustments);
	}

	addLeaveThrough(Infinity);
	adjustments.push(...workAttendance.adjustments);

	const repaymentRecoveries = options.deferredWagesOnly
		? []
		: measureLoanRecoveries({
				bundle,
				configuration,
				period: options.period,
				cutoffDay,
				cadence,
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
					periodEntries.filter((entry) => entry.family === family).map((entry) => entry.id)
				])
			) as unknown as Record<PayRequestFamily, readonly string[]>,
			leave: measuredLeave.captures,
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
 * `calculateFamilies`. The number that comes out is that month's gross: prorated wage, standing
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
		| 'consumedEntries'
		| 'consumedRepayments'
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
	return amount <= 0 ? null : { period: owed.period, componentCatalogueId, amount };
}

import { Effect } from 'effect';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import { prepareWorkCatalogue, prepareWorkInputs } from './work.js';
import {
	prepareMoneyCatalogues,
	prepareMoneyInputs,
	prepareAllowanceSources,
	prepareMoneyConsumption
} from './money.js';
import { prepareLoanCatalogue, prepareLoanPayroll, prepareLoanConsumption } from './loan.js';
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
		const { payItems, ...workConfiguration } = work;
		return {
			...workConfiguration,
			contributions,
			catalogueLeaves,
			catalogueComponents: [...payItems, ...money, ...loans].toSorted(
				(a, b) => decodeNumber(a.sequence) - decodeNumber(b.sequence)
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
}) {
	return Effect.gen(function* () {
		const [leaveByEmployment, requestsByEmployment] = yield* Effect.all(
			[prepareLeavePayroll(options), prepareMoneyInputs(options)],
			{ concurrency: 'unbounded' }
		);
		return { leaveByEmployment, requestsByEmployment };
	});
}
export function prepareFamilyInputs(
	options: Parameters<typeof prepareAllowanceSources>[0] & {
		readonly complianceSpan: PayrollWindow['attendance'];
	}
) {
	return Effect.gen(function* () {
		const { allowanceConfigurations, allowanceMonthsByEmployment } =
			yield* prepareAllowanceSources(options);
		const inputOptions = {
			...options,
			employmentIds: options.employments.map((row) => row.id),
			allowanceConfigurations,
			allowanceMonthsByEmployment
		};
		const [work, loans, factsByEmployment] = yield* Effect.all(
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
			factsByEmployment,
			allowanceConfigurations,
			allowanceMonthsByEmployment
		};
	});
}
export function prepareFamilyHistory(
	options: Parameters<typeof contributionYearToDate>[0] & {
		readonly api: PayrollReadApi & { readonly reads: ReadLog };
	}
) {
	return Effect.gen(function* () {
		const scope = { api: options.api, payslipIds: options.payslips.map((row) => row.id) };
		const [consumedEntries, consumedRepayments] = yield* Effect.all(
			[prepareMoneyConsumption(scope), prepareLoanConsumption(scope)],
			{ concurrency: 'unbounded' }
		);
		return { yearToDate: contributionYearToDate(options), consumedEntries, consumedRepayments };
	});
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
			source.jurisdiction.jurisdiction_code,
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
								.map((input) => [`${input.jurisdiction_code}/${input.date}`, input])
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
	if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));
	const measuredContracts: Array<
		Parameters<typeof assessContributions>[0][number] & {
			readonly measured: ReturnType<typeof calculateFamilies>;
			readonly termsThrough: string;
		}
	> = [];
	const taxYearStartMonth = decodeNumber(configuration.jurisdiction.tax_year_start_month);

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
			consumedEntries: gathered.consumedEntries,
			consumedRepayments: gathered.consumedRepayments
		});

		issues.push(...validateWorkResult({ configuration, measured }));

		measuredContracts.push({
			measured,
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
				.at(-1)!,
			...prepareContributionAssessment({
				measured,
				configuration,
				projection,
				yearToDate: gathered.yearToDate,
				headcount: gathered.headcount
			})
		});
	}

	// 6 — CONTRIBUTE once per person/entity assessment; outputs remain on their own contracts.
	const chargesByEmployment = assessContributions(measuredContracts);
	return { measuredContracts, chargesByEmployment, issues };
}
