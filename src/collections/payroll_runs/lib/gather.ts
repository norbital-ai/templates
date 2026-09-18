import { resolveEmployment, type ResolvedEmployment } from '../../../lib/employment-contract.js';
/**
 * Step 3 — GATHER.
 *
 * Everything about people, read once for the whole run: who was employed, on what terms, where they
 * stand with each statutory scheme, which component entries and loan repayments they bring to this
 * period, what leave they moved, what they planned and clocked, what has already been consumed from
 * the depleting sources, and what they have already been paid this tax year.
 *
 * Only **live** rows are read — `approval_id IS NULL`. On this platform a null approval
 * stamp means the row is in force; a set one means it is still pending, and pending money is not
 * money. That predicate is on every query here without exception, which is also why these reads are
 * separate batched queries rather than one nested `with`: a nested relation is read whole and
 * cannot carry a `where`, so folding them together would silently consume pending rows.
 *
 * It answers *liveness* and nothing else, and that boundary is worth stating because it used to be
 * crossed. `approval_id` was also being read as a write lock, so one column stood for both
 * "payroll may consume this row" and "nobody may edit this row" — which meant the workspace had no
 * way at all to record that a row *had* been consumed. Consumption is now the pin: the engine
 * sets `payslip_id` on the source row it consumed. All approved siblings remain
 * available for cap accounting; a standing capture excludes a single-use entry from settlement.
 * Recurring allowances remain eligible in each period their range covers.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '../$types.js';
import { PAGE_LIMIT, type PayrollReadApi, type ReadLog } from './api.js';
import type { Configuration } from './configuration.js';
import {
	prepareFamilyObligations,
	prepareFamilyInputs,
	prepareFamilyHistory
} from '../../../lib/payroll/families.js';
import {
	completedMonths,
	completedYears,
	dateKey,
	monthBounds,
	monthKey,
	periodMonth,
	type IsoDate
} from './dates.js';
import { requestIsDue, type PreparedPayRequest } from '../../../lib/payroll/money.js';
import type { PreparedLoan, LoanRepayment } from '../../../lib/payroll/loan.js';
import { coversDate, effectiveWithin, live, overlapsRange } from './effective.js';
import {
	hasLeavePayment,
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
import { decodeNumber } from '@norbital-ai/std/json';

type Employment = ResolvedEmployment;
type Employee = WorkspaceRow<'employees'>;
type EmploymentTerms = WorkspaceRow<'employment_terms'>;
type StatutoryFact = WorkspaceRow<'employment_statutory_facts'>;

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
	 * Set when this period is being deferred. The bundle is measured exactly like every other one —
	 * that is the point, the amount owed is what the run *would* have paid — and then diverted at
	 * persistence into base pay for the deferred period instead of a payslip.
	 */
	readonly deferral: EmploymentSettlement['deferral'];
};

export type GatheredRun = {
	/** Everyone the run measures — deferred periods included; `bundle.deferral` tells them apart. */
	readonly bundles: readonly EmploymentBundle[];
	/** Active employments in the company at the period end — the HEADCOUNT band selector. */
	readonly headcount: number;
	/** Of them, the citizens (`residency_status` other than FOREIGNER): MY HRD Corp counts and levies these alone. */
	readonly headcountCitizens: number;
	/** `${employee_id}:${contribution_code}` → what has already been charged this tax year. */
	readonly yearToDate: ReadonlyMap<
		string,
		{ employee: number; employer: number; base: number; ordinary: number }
	>;
	/** employee id → component code → what the person's earlier payslips earned this tax year. */
	readonly yearEarned: ReadonlyMap<string, ReadonlyMap<string, number>>;
	/** employee id → calendar month → component code → what earlier payslips earned; `earned_average` reads it. */
	readonly earnedByMonth: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, number>>>;
	/** employee id → calendar month → regulated overtime hours earlier payslips settled. */
	readonly priorOvertimeHours: ReadonlyMap<string, ReadonlyMap<string, number>>;
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

/** What `gatherRun` needs: the reads, the picked law and the window. */
type GatherRunOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: Configuration;
	readonly window: PayrollWindow;
};

export function gatherRun(options: GatherRunOptions): Effect.Effect<GatheredRun, never, never> {
	return Effect.gen(function* () {
		const { window } = options;
		const period = window.period;
		const salary = window.salary;
		const db = options.api.db;
		const approved = { approval_id: { isNull: true } } as const;
		const companyId = options.configuration.company.id;

		const employmentRows = live(
			yield* db.employments.findMany({
				where: { company_id: { eq: companyId }, ...approved },
				limit: PAGE_LIMIT
			})
		).map(resolveEmployment);
		options.api.reads.assertComplete(employmentRows, 'employments');

		const begun = employmentRows.filter((row) => employmentDates(row).hire <= salary.end);
		const { leaveByEmployment: gatheredLeave, requestsByEmployment: requestsByEmploymentGathered } =
			yield* prepareFamilyObligations({
				api: options.api,
				configuration: options.configuration,
				employments: begun,
				period,
				asOf: salary.end,
				periodWindow: { start: salary.start, end: salary.end }
			});
		const touching = begun.filter((row) =>
			overlapsRange(row.effective_range, salary.start, salary.end)
		);
		// An outstanding claim keeps an ended contract in the run; a standing allowance ended with
		// the contract and never selects it.
		const hasOutstandingRequest = (employmentId: string) =>
			(requestsByEmploymentGathered.get(employmentId) ?? []).some(
				(request) => request.window == null && !request.captured
			);
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
		const touchingIds = candidates.map((row) => row.id);
		// Terms and people in one round: both are needed for every candidate, by the cadence
		// resolution here and by the leave verdicts below, so neither is read again later.
		const [termRows, employeeRows] = yield* Effect.all(
			[
				touchingIds.length === 0
					? Effect.succeed([])
					: db.employment_terms.findMany({
							where: { employment_id: { in: touchingIds }, ...approved },
							limit: PAGE_LIMIT
						}),
				touchingIds.length === 0
					? Effect.succeed([])
					: db.employees.findMany({
							where: {
								id: { in: [...new Set(candidates.map((row) => row.employee_id))] },
								...approved
							},
							limit: PAGE_LIMIT
						})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(termRows, 'employment terms');
		options.api.reads.assertComplete(employeeRows, 'employees');
		const termsByEmployment = Map.groupBy(live(termRows), (row) => row.employment_id);
		const employeeById = new Map(live(employeeRows).map((row) => [row.id, row]));
		const company = options.configuration.company;
		const leaveByEmployment = new Map(
			candidates.flatMap((row) => {
				const employee = employeeById.get(row.employee_id);
				const gathered = gatheredLeave.get(row.id);
				if (employee == null || gathered == null) return [];
				return [
					[
						row.id,
						withLeaveDeductionEligibility(gathered, {
							employment: row,
							employee,
							company,
							terms: termsByEmployment.get(row.id) ?? []
						})
					] as const
				];
			})
		);
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
				(requestsByEmployment.get(row.id) ?? []).some(
					(request) =>
						request.window == null &&
						requestIsDue(
							request,
							period,
							cadence.window.salary,
							decodeNumber(company.pay_cutoff_day),
							{ company, payFrequency: cadence.payFrequency }
						)
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
		// between the halves. A deferred joining period pays nobody and is not counted.
		const month = monthBounds(periodMonth(period));
		const onTheBooks = touching.filter((row) => {
			const dates = employmentDates(row);
			if (dates.hire > month.end || (dates.exit != null && dates.exit < month.start)) return false;
			return settlementByEmployment.get(row.id)?.deferral == null;
		});
		const headcount = new Set(onTheBooks.map((row) => row.employee_id)).size;
		const headcountCitizens = new Set(
			onTheBooks
				.filter((row) =>
					(termsByEmployment.get(row.id) ?? []).some(
						(term) =>
							coversDate(term.effective_range, month.end) && term.residency_status !== 'FOREIGNER'
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
				yearToDate: new Map(),
				yearEarned: new Map(),
				earnedByMonth: new Map(),
				priorOvertimeHours: new Map(),
				consumedEntries: new Map()
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
		const [
			{
				factsByEmployee,
				loansByEmployment,
				repaymentsByLoan,
				workDaysByEmployment,
				rostersByEmployment
			},
			prior
		] = yield* Effect.all(
			[
				prepareFamilyInputs({
					api: options.api,
					configuration: options.configuration,
					employments,
					requestsByEmployment,
					cadenceByEmployment,
					period,
					periodWindow: { start: salary.start, end: salary.end },
					window,
					complianceSpan
				}),
				gatherPriorSettlement({
					api: options.api,
					configuration: options.configuration,
					period,
					employeeIds,
					companyId
				})
			],
			{ concurrency: 'unbounded' }
		);
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
			const hire = start == null ? null : dateKey(start);
			if (hire == null) refuse(`Employment ${employment.employee_number} has no service start.`);
			const dob = dateKey(employee.date_of_birth);
			const statutoryFacts = factsByEmployee.get(employment.employee_id) ?? [];
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
				leave: leaveByEmployment.get(employment.id)!,
				termsHistory: termsByEmployment.get(employment.id) ?? [],
				workDays: workDaysByEmployment.get(employment.id) ?? [],
				rosters: rostersByEmployment.get(employment.id) ?? [],
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
	});
}

/**
 * Year-to-date statutory charges, and what earlier paid runs already took from each depleting
 * source.
 *
 * Two faults in the engine of record are fixed here, and both were verified to be safe against the
 * parity baseline before being changed:
 *
 * 1. **YTD is keyed on the employee, not the employment.** A transfer or a rehire creates a new
 *    employment, which zeroed the year-to-date mid-year and reset the PCB projection and both
 *    relief pools with it. The 2026 population has no transfers, so fixing it moves nothing today
 *    and stops misstating tax the first time someone moves (decision L34 / risk register #11).
 * 2. **Every earlier slip counts, paid or not.** An abandoned draft once fed the next period's
 *    projection; today no earlier run or slip can be deleted from under a later one, and payment
 *    is ordered per person, so what stands is what will have been paid.
 *
 * ## Year-to-date is a sum over payslips alone
 *
 * The statutory charges are inlined on the payslip, so the year-to-date figure is a jsonb
 * aggregation over rows this function already had in hand — it needs no second collection and no
 * join. What still needs a read is *consumption*, which lives on the captured-input adjustments;
 * those reads are narrowed to the two depleting arms, because a work day or a leave request
 * depletes nothing.
 */
type GatherPriorSettlementOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: Configuration;
	readonly period: string;
	readonly companyId: string;
	readonly employeeIds: readonly string[];
};

type PriorSettlement = {
	readonly yearToDate: Map<
		string,
		{ employee: number; employer: number; base: number; ordinary: number }
	>;
	readonly yearEarned: Map<string, Map<string, number>>;
	readonly earnedByMonth: Map<string, Map<string, Map<string, number>>>;
	readonly priorOvertimeHours: Map<string, Map<string, number>>;
	readonly consumedEntries: Map<string, number>;
};

function gatherPriorSettlement(
	options: GatherPriorSettlementOptions
): Effect.Effect<PriorSettlement, never, never> {
	return Effect.gen(function* () {
		const db = options.api.db;
		const startMonth = decodeNumber(
			options.configuration.jurisdiction.payroll.tax_year_start_month
		);
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
		const priorRunRows = yield* db.payroll_runs.findMany({
			where: { company_id: { eq: options.companyId }, period: { lt: options.period } },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(priorRunRows, 'prior payroll runs');
		const priorRuns = priorRunRows;
		const inTaxYear = new Set(
			priorRuns
				.filter(
					(run) =>
						run.period >= firstPeriod &&
						taxYearOf(run.period, startMonth) === taxYearOf(options.period, startMonth)
				)
				.map((run) => run.id)
		);
		const totals = new Map<
			string,
			{ employee: number; employer: number; base: number; ordinary: number }
		>();
		const consumedEntries = new Map<string, number>();
		const empty = {
			yearToDate: totals,
			yearEarned: new Map<string, Map<string, number>>(),
			earnedByMonth: new Map<string, Map<string, Map<string, number>>>(),
			priorOvertimeHours: new Map<string, Map<string, number>>(),
			consumedEntries
		};
		if (priorRuns.length === 0 || options.employeeIds.length === 0) return empty;

		// Employments are resolved employee-first so a mid-year transfer keeps its history: the person
		// is the taxpayer, not the contract.
		const siblingEmploymentRows = yield* db.employments.findMany({
			where: {
				company_id: { eq: options.companyId },
				employee_id: { in: [...options.employeeIds] }
			},
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(siblingEmploymentRows, 'sibling employments');
		const siblingEmployments = live(siblingEmploymentRows);
		const employmentToEmployee = new Map(
			siblingEmployments.map((row) => [row.id, row.employee_id])
		);
		const priorPayslips = yield* db.payslips.findMany({
			where: {
				payroll_run_id: { in: priorRuns.map((run) => run.id) },
				employment_id: { in: siblingEmployments.map((row) => row.id) }
			},
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(priorPayslips, 'prior payslips');
		if (priorPayslips.length === 0) return empty;

		return yield* prepareFamilyHistory({
			api: options.api,
			payslips: priorPayslips,
			inTaxYear,
			employmentToEmployee,
			periodByRun: new Map(priorRuns.map((run) => [run.id, run.period]))
		});
	});
}
