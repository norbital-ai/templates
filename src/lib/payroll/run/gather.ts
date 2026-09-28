import { resolveEmployment, type ResolvedEmployment } from '../../../lib/employment-contract.js';
/**
 * Step 3 — GATHER: everything about people, once for the whole run — employments, terms, statutory
 * standing, entries and repayments, leave, work days, what was consumed, and what was paid this tax
 * year. Only live rows (`approval_id` null) are read: pending money is not money. Consumption is
 * the pin (`payslip_id`); approved siblings stay available for cap accounting.
 */

import type { InLieuSlice } from '../../../lib/datatypes/payroll_trace.js';
import { refuse } from '../../../lib/refuse.js';
import type { WorkspaceRow } from '../../../lib/rows.js';
import type { PayrollWorld } from '../world.js';
import type { Configuration } from './configuration.js';
import {
	accumulateSettledPayslip,
	sumAccumulations,
	type CompanyMonthPrior,
	type MonthPrior,
	type QuantityPayment
} from './accumulate.js';
import { prepareFamilyHistory } from '../../../lib/payroll/families.js';
import { prepareWorkInputs } from '../work.js';
import { prepareLoanPayroll } from '../loan.js';
import { contributionYearToDate, prepareContributionInputs } from '../contribution.js';
import {
	completedMonths,
	completedYears,
	monthBounds,
	monthKey,
	periodMonth,
	type IsoDate
} from './dates.js';
import { dateKey } from '../../../lib/iso-day.js';
import {
	prepareMoneyInputs,
	requestIsDue,
	type PreparedPayRequest
} from '../../../lib/payroll/money.js';
import type { PreparedLoan, LoanRepayment } from '../../../lib/payroll/loan.js';
import { coversDate, effectiveWithin, live, overlapsRange } from './effective.js';
import {
	hasLeavePayment,
	prepareLeavePayroll,
	withLeaveDeductionEligibility,
	type PreparedLeavePayroll
} from '../../../lib/leave/payroll.js';
import {
	cadenceWindow,
	employmentPayFrequency,
	paysOn,
	taxYearFirstPeriod,
	taxYearOf,
	type PayFrequency,
	type PayrollWindow
} from './period.js';
import type { WorkDayLike } from './overtime.js';
import {
	employmentDates,
	resolveEmploymentSettlement,
	type EmploymentSettlement
} from './settlement.js';
import { decodeNumber } from '../../wire.js';
import type { StatutoryPeriodHistory } from '../../../lib/payroll/statutory-history.js';
import type {
	PayslipWageMonth,
	ReferenceWagePeriod
} from '../../../lib/payroll/reference-wages.js';

type Employment = ResolvedEmployment;
type Employee = WorkspaceRow<'employees'>;
type EmploymentTerms = WorkspaceRow<'employment_terms'>;
type StatutoryFact = import('./statutory-facts.js').StatutoryFact;

/**
 * One person-day as payroll reads it: the plan, the punch and the break, on one row.
 *
 * Both halves are optional and their absence means something. `shift_definition_id` is the presence
 * test for the plan; `worked_intervals` is the presence test for attendance, where NULL means none
 * was recorded and `[]` means the day was read and nothing was worked.
 */
type WorkDay = WorkDayLike & WorkspaceRow<'work_days'>;

/** One person's whole input to the run. */
export type EmploymentBundle = {
	readonly employment: Employment;
	readonly employee: Employee;
	/** The cadence this employment is paid on, as of the day the run's period closes. */
	readonly payFrequency: PayFrequency;
	/**
	 * The window this run pays the employment over: the one instalment its cadence has in the
	 * period. A semi-monthly employment's is the half the period names; a monthly employment's is
	 * the cutoff window. It is never the run's envelope, which may hold both.
	 */
	readonly window: PayrollWindow;
	/** Every terms row touching the pay period, in effective order — a mid-month raise is two rows. */
	readonly terms: readonly EmploymentTerms[];
	readonly statutoryFacts: readonly StatutoryFact[];
	/** Claims, standing allowances, arrears settlements and corrections, as one view. */
	readonly payRequests: readonly PreparedPayRequest[];
	/** The person's child facts — what `children.under(age)` counts. */
	readonly children: WorkspaceRow<'employees'>['children'];
	/**
	 * The loan agreements this employment carries, each with the catalogue revision it was agreed
	 * under. Payroll consumes their repayments, not these.
	 */
	readonly loans: readonly PreparedLoan[];
	/** The amounts due under those agreements — one of the four input families. */
	readonly loanRepayments: readonly LoanRepayment[];
	readonly leave: PreparedLeavePayroll;
	/** Effective history also covers attendance and approved leave outside the salary window. */
	readonly termsHistory: readonly EmploymentTerms[];
	/** Plan and punch together. */
	readonly workDays: readonly WorkDay[];
	/** Approved dated wage history a statutory ordinary rate or conversion may consume. */
	readonly wagePeriods: readonly ReferenceWagePeriod[];
	/** The person's earlier payslips as months of pay, the record a normal-wage reference reads first. */
	readonly payslipWageMonths?: readonly PayslipWageMonth[] | undefined;
	/** The rosters of record whose cycles touch the attendance span, as day ranges. */
	readonly rosters: readonly { readonly start: IsoDate; readonly end: IsoDate }[];
	/** Completed months of service at the period end. */
	readonly serviceMonths: number;
	/** Completed years of age at the period end, or `null` when no date of birth is recorded. */
	readonly age: number | null;
	/** The days of the pay period this employment covers, or `null` when it covers none. */
	readonly employedDays: { readonly start: IsoDate; readonly end: IsoDate } | null;
	/** The span recurring salary and recurring allowances cover under the company's final-pay rule. */
	readonly wageDays: { readonly start: IsoDate; readonly end: IsoDate } | null;
	/**
	 * The attendance days **this employment** is measured over. Identical to the run's window for
	 * everyone except a leaver settling in their final period, whose window runs to the exit date.
	 */
	readonly attendance: { readonly start: IsoDate; readonly end: IsoDate };
	/** An earlier period this run is paying out, set only after a deferred joining period. */
	readonly arrearsFor: EmploymentSettlement['arrearsFor'];
	/**
	 * Defers monetary settlement while retaining this period's statutory insurance assessment.
	 */
	readonly deferral: EmploymentSettlement['deferral'];
};

export type GatheredRun = {
	/** Everyone the run measures — deferred periods included; `bundle.deferral` tells them apart. */
	readonly bundles: readonly EmploymentBundle[];
	/** Active employments in the company at the period end — the HEADCOUNT band selector. */
	readonly headcount: number;
	/** Of them, the citizens: MY HRD Corp counts and levies these alone. */
	readonly headcountCitizens: number;
	/** `${employee_id}:${contribution_code}` → what has already been charged this tax year. */
	readonly yearToDate: ReadonlyMap<
		string,
		{ employee: number; employer: number; base: number; ordinary: number; rebate?: number }
	>;
	/** `${employee_id}:${contribution_code}` → what was charged in the tax year before this one. */
	readonly lastYear?: ReadonlyMap<
		string,
		{ employee: number; employer: number; base: number; ordinary: number; rebate?: number }
	>;
	/** `${employee_id}:${contribution_code}` → the earliest tax year an earlier slip charged a base. */
	readonly firstYear?: ReadonlyMap<string, number>;
	/** employee id → earlier paid statutory assessments in this tax year, grouped by payroll period. */
	readonly statutoryHistory: ReadonlyMap<string, readonly StatutoryPeriodHistory[]>;
	/** employee id → component code → what the person's earlier payslips earned this tax year. */
	readonly yearEarned: ReadonlyMap<string, ReadonlyMap<string, number>>;
	readonly yearQuantityPayments?: ReadonlyMap<
		string,
		ReadonlyMap<string, readonly QuantityPayment[]>
	>;
	/** employee id → calendar month → component code → what earlier payslips earned; `earned_average` reads it. */
	readonly earnedByMonth: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, number>>>;
	/** employee id → limit key (`''` regulated) → calendar month → overtime earlier payslips settled. */
	readonly priorOvertimeHours: ReadonlyMap<
		string,
		ReadonlyMap<string, ReadonlyMap<string, number>>
	>;
	/** employee id → the in-lieu slices earlier payslips credited and paid (TW 勞基法 §32-1). */
	readonly priorInLieu?: ReadonlyMap<string, readonly InLieuSlice[]> | undefined;
	/** `employee id:YYYY-MM` → what the month's earlier instalments settled and charged. */
	readonly monthPrior: ReadonlyMap<string, MonthPrior>;
	readonly companyMonthPrior?: CompanyMonthPrior | undefined;
	/**
	 * pay request id → what earlier runs took from it.
	 *
	 * A one-off entry is single-use — one standing/paid payslip captures it and later runs
	 * exclude it — so this map is the defence-in-depth ceiling rather than the working answer.
	 * The cap arithmetic inside the one capturing payslip is where a claim settles for less than it
	 * asked for, and a capped claim leaves no invented balance behind.
	 */
	readonly consumedEntries: ReadonlyMap<string, number>;
};

/** What `gatherRun` needs: the world, the picked law and the window. */
type GatherRunOptions = {
	readonly world: PayrollWorld;
	readonly configuration: Configuration;
	readonly window: PayrollWindow;
};

export function gatherRun(options: GatherRunOptions): GatheredRun {
	const { window, world, configuration } = options;
	const period = window.period;
	const salary = window.salary;
	const companyId = configuration.company.id;

	const employmentRows = live(world.employments)
		.filter((row) => row.company_id === companyId)
		.map(resolveEmployment);

	const begun = employmentRows.filter((row) => employmentDates(row).hire <= salary.end);
	const gatheredLeave = prepareLeavePayroll({
		world,
		employments: begun,
		versions: configuration.lineageVersions,
		currency: configuration.jurisdiction.payroll.currency
	});
	const { requestsByEmployment: requestsByEmploymentGathered } = prepareMoneyInputs({
		world,
		configuration,
		employmentIds: begun.map((row) => row.id)
	});
	const touching = begun.filter((row) =>
		overlapsRange(row.effective_range, salary.start, salary.end)
	);
	// An outstanding claim or ad hoc request keeps an ended contract in the run.
	const hasOutstandingRequest = (employmentId: string) =>
		(requestsByEmploymentGathered.get(employmentId) ?? []).some((request) => !request.captured);
	const candidates = begun.filter(
		(row) =>
			touching.includes(row) ||
			hasLeavePayment(gatheredLeave.get(row.id)!, salary.end) ||
			hasOutstandingRequest(row.id)
	);
	// Terms are read first, because the cadence decides the window each employment is settled
	// on. A semi-monthly employment is settled over the half the period names; a monthly one over
	// the cutoff window, which a semi-monthly company only pays in the second half, so in the
	// first half the monthly cadence has no window and its people are simply not in the run.
	// A cadence the company cannot pay falls back to the run's own window, so the bundle exists
	// for `validatePayCalendar` to refuse by name rather than throwing here.
	// Terms and people in one round: both are needed for every candidate, by the cadence
	// resolution here and by the leave verdicts below, so neither is read again later.
	const candidateIds = new Set(candidates.map((row) => row.id));
	const candidatePeople = new Set(candidates.map((row) => row.employee_id));
	const termsByEmployment = Map.groupBy(
		live(world.employment_terms).filter((row) => candidateIds.has(row.employment_id)),
		(row) => row.employment_id
	);
	const employeeById = new Map(
		live(world.employees)
			.filter((row) => candidatePeople.has(row.id))
			.map((row) => [row.id, row])
	);
	const company = options.configuration.company;
	const cadenceByEmployment = new Map<
		string,
		{ readonly window: PayrollWindow; readonly payFrequency: PayFrequency }
	>();
	const settlementByEmployment = new Map<string, EmploymentSettlement>();
	for (const row of candidates) {
		const exit = employmentDates(row).exit;
		const payFrequency = employmentPayFrequency(
			termsByEmployment.get(row.id) ?? [],
			exit != null && exit < salary.end ? exit : salary.end
		);
		const cadence = paysOn(company, payFrequency)
			? cadenceWindow(period, company, payFrequency)
			: window;
		if (cadence == null) continue;
		cadenceByEmployment.set(row.id, { window: cadence, payFrequency });
		settlementByEmployment.set(
			row.id,
			resolveEmploymentSettlement({ dates: employmentDates(row), window: cadence })
		);
	}

	const requestsByEmployment = requestsByEmploymentGathered;
	const employments = candidates.filter((row) => {
		const settlement = settlementByEmployment.get(row.id);
		const cadence = cadenceByEmployment.get(row.id);
		const dueRequest =
			cadence != null &&
			(requestsByEmployment.get(row.id) ?? []).some((request) =>
				requestIsDue(request, period, cadence.window.salary, company.pay_cutoff_day, {
					company,
					payFrequency: cadence.payFrequency
				})
			);
		return (
			settlement != null &&
			(settlement.runs ||
				settlement.deferral != null ||
				hasLeavePayment(gatheredLeave.get(row.id)!, salary.end) ||
				dueRequest)
		);
	});
	// Headcount is who the company employs in the month, not who this run pays: a monthly
	// employment is on the books in the first half of a semi-monthly month even though that run
	// pays it nothing, and a headcount-banded contribution for everyone else must not move
	// between the halves. Deferring a joining wage does not remove the employee from headcount.
	const month = monthBounds(periodMonth(period));
	const onTheBooks = touching.filter((row) => {
		const dates = employmentDates(row);
		return dates.hire <= month.end && (dates.exit == null || dates.exit >= month.start);
	});
	const headcount = new Set(onTheBooks.map((row) => row.employee_id)).size;
	const headcountCitizens = new Set(
		onTheBooks
			.filter((row) =>
				(termsByEmployment.get(row.id) ?? []).some(
					(term) =>
						coversDate(term.effective_range, month.end) && term.residency_status === 'CITIZEN'
				)
			)
			.map((row) => row.employee_id)
	).size;
	const employmentIds = employments.map((row) => row.id);
	if (employmentIds.length === 0)
		return {
			bundles: [],
			headcount,
			headcountCitizens,
			...gatherPriorSettlement({ world, configuration, period, employeeIds: [], companyId })
		};

	// One query span covers everyone: the widest attendance window any employment settles over, so
	// a leaver's tail is read in the same round trip as everybody else's window.
	const attendanceSpan = [...settlementByEmployment.values()].reduce(
		(span, settlement) => ({
			start: settlement.attendance.start < span.start ? settlement.attendance.start : span.start,
			end: settlement.attendance.end > span.end ? settlement.attendance.end : span.end
		}),
		{ start: window.attendance.start, end: window.attendance.end }
	);
	// A cutoff can straddle two months, but the 104-hour statutory counter resets on the first of
	// each calendar month. Read both months in full so 1st–20th work can correctly affect later
	// 21st–month-end work (and vice versa when it is paid in the following run).
	const complianceSpan = {
		start: monthBounds(monthKey(attendanceSpan.start)).start,
		end: monthBounds(monthKey(attendanceSpan.end)).end
	};

	const employeeIds = [...new Set(employments.map((row) => row.employee_id))];
	// The prior settlement needs only the employees and the period, so it is read beside the
	// family inputs rather than after them: on a network database every wave of reads is a
	// round trip, and this one was three in a row at the end of the gather.
	const { workDaysByEmployment, rostersByEmployment, wagePeriodsByEmployment } = prepareWorkInputs({
		world,
		employmentIds,
		complianceSpan
	});
	const { loansByEmployment, repaymentsByLoan } = prepareLoanPayroll({ world, employmentIds });
	const factsByEmployee = prepareContributionInputs({ world, employeeIds, configuration });
	const prior = gatherPriorSettlement({ world, configuration, period, employeeIds, companyId });
	const bundles: EmploymentBundle[] = [];
	for (const employment of employments) {
		const employee = employeeById.get(employment.employee_id);
		if (!employee)
			refuse(`Employment ${employment.employee_number} has no approved employee record.`);
		const settlement = settlementByEmployment.get(employment.id);
		const cadence = cadenceByEmployment.get(employment.id);
		if (!settlement || !cadence)
			refuse(`Employment ${employment.employee_number} was gathered without a settlement.`);
		const paid = cadence.window.salary;
		const start = employment.effective_range?.start;
		const hire = dateKey(start);
		if (hire === '') refuse(`Employment ${employment.employee_number} has no service start.`);
		const dob = dateKey(employee.date_of_birth) || null;
		const statutoryFacts = (factsByEmployee.get(employment.employee_id) ?? []).filter(
			(fact) => fact.employment_id == null || fact.employment_id === employment.id
		);
		const employmentLoans = loansByEmployment.get(employment.id) ?? [];
		bundles.push({
			employment,
			employee,
			payFrequency: cadence.payFrequency,
			window: cadence.window,
			terms: effectiveWithin(termsByEmployment.get(employment.id) ?? [], paid.start, paid.end),
			statutoryFacts,
			payRequests: requestsByEmployment.get(employment.id) ?? [],
			children: employee.children,
			loans: employmentLoans,
			loanRepayments: employmentLoans.flatMap((loan) => repaymentsByLoan.get(loan.id) ?? []),
			leave: withLeaveDeductionEligibility(gatheredLeave.get(employment.id)!, {
				employment,
				servicePeriods: employmentRows
					.filter((row) => row.employee_id === employment.employee_id)
					.map((row) => ({
						start: dateKey(row.effective_range?.start),
						end: row.effective_range?.end == null ? null : dateKey(row.effective_range.end)
					})),
				employee,
				configuration: options.configuration,
				statutoryFacts,
				terms: termsByEmployment.get(employment.id) ?? []
			}),
			termsHistory: termsByEmployment.get(employment.id) ?? [],
			workDays: workDaysByEmployment.get(employment.id) ?? [],
			rosters: rostersByEmployment.get(employment.id) ?? [],
			wagePeriods: wagePeriodsByEmployment.get(employment.id) ?? [],
			payslipWageMonths: prior.payslipWageMonths.get(employment.employee_id) ?? [],
			serviceMonths: completedMonths(hire, paid.end),
			age: dob == null ? null : completedYears(dob, paid.end),
			employedDays: settlement.employedDays,
			wageDays: settlement.wageDays,
			attendance: settlement.attendance,
			arrearsFor: settlement.arrearsFor,
			deferral: settlement.deferral
		});
	}

	return { bundles, headcount, headcountCitizens, ...prior };
}

/**
 * Year-to-date statutory charges, and what earlier runs took from each depleting source. YTD is
 * keyed on the employee, not the employment, so a transfer or rehire keeps its history (L34), and
 * every earlier slip counts, paid or not: none can be deleted from under a later one. YTD sums the
 * payslips' inlined charges; consumption reads the two depleting request families.
 */
type GatherPriorSettlementOptions = {
	readonly world: PayrollWorld;
	readonly configuration: Configuration;
	readonly period: string;
	readonly companyId: string;
	readonly employeeIds: readonly string[];
};

type PriorSettlement = {
	readonly yearToDate: Map<
		string,
		{ employee: number; employer: number; base: number; ordinary: number; rebate?: number }
	>;
	readonly lastYear: ReadonlyMap<
		string,
		{ employee: number; employer: number; base: number; ordinary: number; rebate?: number }
	>;
	readonly firstYear: ReadonlyMap<string, number>;
	readonly yearEarned: Map<string, Map<string, number>>;
	readonly yearQuantityPayments: Map<string, Map<string, QuantityPayment[]>>;
	readonly earnedByMonth: Map<string, Map<string, Map<string, number>>>;
	readonly priorOvertimeHours: Map<string, Map<string, Map<string, number>>>;
	readonly priorInLieu: Map<string, InLieuSlice[]>;
	readonly payslipWageMonths: Map<string, PayslipWageMonth[]>;
	readonly monthPrior: Map<string, MonthPrior>;
	readonly companyMonthPrior?: CompanyMonthPrior | undefined;
	readonly consumedEntries: Map<string, number>;
	readonly statutoryHistory: ReadonlyMap<string, readonly StatutoryPeriodHistory[]>;
};

function gatherPriorSettlement(options: GatherPriorSettlementOptions): PriorSettlement {
	const { world } = options;
	const startMonth = options.configuration.jurisdiction.payroll.tax_year_start_month;
	const firstPeriod = taxYearFirstPeriod(options.period, startMonth);
	/**
	 * Every earlier settled run, not only this tax year's.
	 *
	 * Year-to-date is a tax-year question and is still filtered as one below. What a standing
	 * entry has already paid is not: an allowance written in November is still being consumed
	 * in February. One read answers both questions; only the summing differs.
	 */
	/**
	 * Every earlier run, and every slip inside them, paid or not.
	 *
	 * A slip is history from the moment its run stands, because nothing can take it away from
	 * under this one: an earlier run is not deletable while a later sibling exists, an earlier
	 * slip is not deletable while the person has a later one, and payment is ordered per person
	 * — so by the time this period's slip is paid, every earlier slip it counted has been. That
	 * is exactly the "accumulated remuneration paid in previous months" the PCB schedule reads,
	 * where a slip built while the person's January was still held used to under-project the
	 * year and could not be rebuilt once January was paid.
	 */
	const priorRuns = world.payroll_runs.filter(
		(run) => run.company_id === options.companyId && run.period < options.period
	);
	const monthRuns = priorRuns.filter(
		(run) => run.period.slice(0, 7) === options.period.slice(0, 7)
	);
	let companyMonthPrior: CompanyMonthPrior | undefined;
	if (
		monthRuns.length > 0 &&
		options.configuration.contributions.some(
			(entry) =>
				(entry.row.assessment_scope === 'COMPANY' &&
					entry.row.assessment_period !== 'PAY_PERIOD') ||
				entry.row.remittance_rounding === 'FLOOR_MAJOR_UNIT'
		)
	) {
		const runIds = new Set(monthRuns.map((run) => run.id));
		const payslips = world.payslips.filter((slip) => runIds.has(slip.payroll_run_id));
		const totals = (
			rows: readonly {
				scheme_code: string;
				base_amount: number;
				employee_amount: number;
				employer_amount: number;
			}[]
		) => {
			const sums = new Map<
				string,
				{ base: number; ordinary: number; employee: number; employer: number }
			>();
			for (const row of rows) {
				const previous = sums.get(row.scheme_code) ?? {
					base: 0,
					ordinary: 0,
					employee: 0,
					employer: 0
				};
				sums.set(row.scheme_code, {
					base: previous.base + row.base_amount,
					ordinary: 0,
					employee: previous.employee + row.employee_amount,
					employer: previous.employer + row.employer_amount
				});
			}
			return sums;
		};
		const components = new Map(
			options.configuration.catalogueComponents.map((component) => [component.code, component])
		);
		companyMonthPrior = {
			accumulation: sumAccumulations(
				payslips.map((slip) => accumulateSettledPayslip(slip, components))
			),
			produced: totals(payslips.flatMap((slip) => slip.statutory)),
			unrounded: new Map(
				[
					...totals(
						payslips
							.flatMap((slip) => slip.statutory)
							.filter((row) => row.remittance_rounding === 'NONE')
					)
				].map(([code, sums]) => [code, sums.employer])
			),
			charged: totals(monthRuns.flatMap((run) => run.company_charges ?? []))
		};
	}
	const inTaxYear = new Set(
		priorRuns
			.filter(
				(run) =>
					run.period >= firstPeriod &&
					taxYearOf(run.period, startMonth) === taxYearOf(options.period, startMonth)
			)
			.map((run) => run.id)
	);
	// PP 68/2009 art.2(2): parts of one severance paid within two calendar years are taxed as one,
	// so the year before this one is read too — only through `scheme.last_year`.
	const lastTaxYear = String(decodeNumber(taxYearOf(options.period, startMonth)) - 1);
	const inLastTaxYear = new Set(
		priorRuns
			.filter((run) => taxYearOf(run.period, startMonth) === lastTaxYear)
			.map((run) => run.id)
	);
	const totals = new Map<
		string,
		{ employee: number; employer: number; base: number; ordinary: number }
	>();
	const consumedEntries = new Map<string, number>();
	const empty = {
		companyMonthPrior,
		yearToDate: totals,
		lastYear: totals,
		firstYear: new Map<string, number>(),
		statutoryHistory: new Map<string, readonly StatutoryPeriodHistory[]>(),
		yearEarned: new Map<string, Map<string, number>>(),
		yearQuantityPayments: new Map<string, Map<string, QuantityPayment[]>>(),
		earnedByMonth: new Map<string, Map<string, Map<string, number>>>(),
		priorOvertimeHours: new Map<string, Map<string, Map<string, number>>>(),
		priorInLieu: new Map<string, InLieuSlice[]>(),
		payslipWageMonths: new Map<string, PayslipWageMonth[]>(),
		monthPrior: new Map<string, MonthPrior>(),
		consumedEntries
	};
	if (priorRuns.length === 0 || options.employeeIds.length === 0) return empty;

	// Employments are resolved employee-first so a mid-year transfer keeps its history: the person
	// is the taxpayer, not the contract.
	const people = new Set(options.employeeIds);
	const siblingEmployments = live(world.employments).filter(
		(row) => row.company_id === options.companyId && people.has(row.employee_id)
	);
	const employmentToEmployee = new Map(siblingEmployments.map((row) => [row.id, row.employee_id]));
	const priorRunIds = new Set(priorRuns.map((run) => run.id));
	const priorPayslips = world.payslips.filter(
		(slip) => priorRunIds.has(slip.payroll_run_id) && employmentToEmployee.has(slip.employment_id)
	);
	if (priorPayslips.length === 0) return empty;
	// PP 68/2009 art.6(1): a severance part paid in the third calendar year counted from the first
	// part leaves the art.2(2) window, so the year of the first charged base is read too.
	const periodByRun = new Map(priorRuns.map((run) => [run.id, run.period]));
	const firstYear = new Map<string, number>();
	for (const slip of priorPayslips) {
		const year = decodeNumber(taxYearOf(periodByRun.get(slip.payroll_run_id)!, startMonth));
		const employeeId = employmentToEmployee.get(slip.employment_id)!;
		for (const charge of slip.statutory) {
			if (charge.base_amount <= 0) continue;
			const key = `${employeeId}:${charge.scheme_code}`;
			if (year < (firstYear.get(key) ?? Infinity)) firstYear.set(key, year);
		}
	}

	return {
		companyMonthPrior,
		...prepareFamilyHistory({
			world,
			payslips: priorPayslips,
			inTaxYear,
			employmentToEmployee,
			periodByRun,
			traceByRun: new Map(priorRuns.map((run) => [run.id, run.calculation_trace])),
			catalogueComponents: options.configuration.catalogueComponents
		}),
		lastYear: contributionYearToDate({
			payslips: priorPayslips,
			inTaxYear: inLastTaxYear,
			employmentToEmployee
		}),
		firstYear
	};
}
