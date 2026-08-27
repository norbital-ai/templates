/**
 * Step 3 — GATHER.
 *
 * Everything about people, read once for the whole run: who was employed, on what terms, where they
 * stand with each statutory scheme, what obligations they carry this period, what leave they moved,
 * what they planned and clocked, and what they have already been paid this tax year.
 *
 * Only **live** rows are read — `approval_id IS NULL`. On this platform a null approval
 * stamp means the row is in force; a set one means it is still pending, and pending money is not
 * money. That predicate is on every query here without exception, which is also why these reads are
 * eight separate batched queries rather than one nested `with`: a nested relation is read whole and
 * cannot carry a `where`, so folding them together would silently consume pending rows.
 *
 * It answers *liveness* and nothing else, and that boundary is worth stating because it used to be
 * crossed. `approval_id` was also being read as a write lock, so one column stood for both
 * "payroll may consume this row" and "nobody may edit this row" — which meant the workspace had no
 * way at all to record that a row *had* been consumed. Settlement is a `payslip_adjustments` row
 * naming the source, produced by MEASURE beside the amount it derived and released by deleting the
 * payslips that hold the claims. Deliberately not here: a source this run settled must still be
 * readable by this run's next rebuild, so a settlement claim is not, and must never become, a
 * filter on these queries.
 *
 * ## Two collections fewer to read
 *
 * `component_entries` and `repayment_agreements` are one collection now, and so are `time_entries`
 * and `roster_entries`. A loan's instalments are on the obligation that owns them rather than
 * copied into entries payroll then had to filter back out, and a person-day's plan and punch arrive
 * on one row rather than being joined on `(employment_id, work_date)` for every day of every run.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '../$types.js';
import { groupBy, PAGE_LIMIT, type PayrollReadApi, type ReadLog } from './api.js';
import type { Configuration } from './configuration.js';
import {
	completedMonths,
	completedYears,
	dateKey,
	monthBounds,
	monthKey,
	type IsoDate
} from './dates.js';
import { effectiveWithin, live, overlapsRange } from './effective.js';
import type { LedgerRow } from './leave.js';
import { taxYearFirstPeriod, taxYearOf, type PayrollWindow } from './period.js';
import type { Obligation } from './obligations.js';
import type { WorkDayLike } from './overtime.js';
import {
	employmentDates,
	inExtendedLeavePopulation,
	resolveEmploymentSettlement,
	type EmploymentSettlement,
	type SettlementPolicy
} from './settlement.js';

type Employment = WorkspaceRow<'employments'>;
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
	/** Every terms row touching the pay period, in effective order — a mid-month raise is two rows. */
	readonly terms: readonly EmploymentTerms[];
	readonly statutoryFacts: readonly StatutoryFact[];
	/** Claims, allowances, bonuses, corrections and loans — the only door money enters through. */
	readonly obligations: readonly Obligation[];
	readonly ledger: readonly LedgerRow[];
	/** Plan and punch together. `roster_entries` and `time_entries` were always one row. */
	readonly workDays: readonly WorkDay[];
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
	 * persistence into an arrears entry instead of a payslip.
	 */
	readonly deferral: EmploymentSettlement['deferral'];
	/** Whether an extended unpaid absence settles in its own month for this employment. */
	readonly extendedLeaveSettlesInOwnMonth: boolean;
};

export type GatheredRun = {
	/** Everyone the run measures — deferred periods included; `bundle.deferral` tells them apart. */
	readonly bundles: readonly EmploymentBundle[];
	/** Active employments in the company at the period end — the HEADCOUNT band selector. */
	readonly headcount: number;
	/** `${employee_id}:${contribution_code}` → what has already been charged this tax year. */
	readonly yearToDate: ReadonlyMap<string, { employee: number; employer: number; base: number }>;
	/**
	 * `obligation_id` → what earlier PAID runs actually took from it.
	 *
	 * This is what replaces carried-forward arrears. A deduction the negative-net guard could not
	 * take used to be copied into a new `component_entries` row dated next month — a second
	 * representation of a debt the agreement already records, written one facility call per employee,
	 * and guarded by a `persistShortfalls` that had to delete last build's copies before writing this
	 * build's so a rebuild could not make somebody owe the same money twice.
	 *
	 * None of that exists now. What a run took is on the adjustment row that took it, so what is
	 * still owed is `obligation.amount` minus the sum of those rows. Nothing is carried, so nothing
	 * can be carried twice, and a rebuild is idempotent because it re-derives rather than re-writes.
	 *
	 * Keyed by the **obligation**, not by an instalment ordinal: `payslip_adjustments` records the
	 * source and the amount, and the source is the obligation. That is also the granularity
	 * `OBLIGATION_OVER_CONSUMED` is stated at.
	 */
	readonly consumedObligations: ReadonlyMap<string, number>;
};

/**
 * What `gatherRun` needs: the reads, the picked law, the window and the settlement policy.
 */
type GatherRunOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: Configuration;
	readonly window: PayrollWindow;
	readonly policy: SettlementPolicy;
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
		);
		options.api.reads.assertComplete(employmentRows, 'employments');

		// Someone is in the run if their employment touches the pay period at all — and then
		// `settlement.ts` says which run that period actually settles in. A leaver paid to the 10th is
		// still paid here; a joiner who started after this run's window closed has a period to settle
		// but no attendance to settle it against, so their money is deferred rather than guessed.
		const touching = employmentRows.filter((row) =>
			overlapsRange(row.effective_range, salary.start, salary.end)
		);
		const settlementByEmployment = new Map<string, EmploymentSettlement>();
		for (const row of touching)
			settlementByEmployment.set(
				row.id,
				resolveEmploymentSettlement({
					dates: employmentDates(row),
					window,
					policy: options.policy
				})
			);

		const employments = touching.filter((row) => {
			const settlement = settlementByEmployment.get(row.id);
			return settlement != null && (settlement.runs || settlement.deferral != null);
		});
		const employmentIds = employments.map((row) => row.id);
		if (employmentIds.length === 0)
			return { bundles: [], headcount: 0, yearToDate: new Map(), consumedObligations: new Map() };

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
		const inEmployments = { employment_id: { in: employmentIds }, ...approved } as const;

		const [employeeRows, termRows, factRows, obligationRows, requestRows, workDayRows] =
			yield* Effect.all(
				[
					db.employees.findMany({
						where: { id: { in: employeeIds }, ...approved },
						limit: PAGE_LIMIT
					}),
					db.employment_terms.findMany({ where: inEmployments, limit: PAGE_LIMIT }),
					db.employment_statutory_facts.findMany({ where: inEmployments, limit: PAGE_LIMIT }),
					db.obligations.findMany({ where: inEmployments, limit: PAGE_LIMIT }),
					db.leave_requests.findMany({ where: inEmployments, limit: PAGE_LIMIT }),
					db.work_days.findMany({
						where: {
							employment_id: { in: employmentIds },
							work_date: { gte: complianceSpan.start, lte: complianceSpan.end },
							...approved
						},
						limit: PAGE_LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
		// Every read above pages to the same ceiling, so every one of them is checked. A silently
		// truncated page is the one failure mode that produces a wrong payroll rather than no payroll:
		// a missing person-day changes a day type, a missing terms row changes a wage, and neither
		// leaves a trace. Work days are the closest to the ceiling of the lot.
		options.api.reads.assertComplete(employeeRows, 'employees');
		options.api.reads.assertComplete(termRows, 'employment terms');
		options.api.reads.assertComplete(factRows, 'statutory facts');
		options.api.reads.assertComplete(obligationRows, 'obligations');
		options.api.reads.assertComplete(requestRows, 'leave requests');
		options.api.reads.assertComplete(workDayRows, 'work days');

		const employeeById = new Map(live(employeeRows).map((row) => [row.id, row]));
		const termsByEmployment = groupBy(live(termRows), (row) => row.employment_id);
		const factsByEmployment = groupBy(live(factRows), (row) => row.employment_id);
		// Every live obligation, whole. There is nothing left to filter out here: the copies that used
		// to need suppressing — `LOAN_INSTALMENT` rows duplicating a schedule, and the seed leftovers
		// on the same (employment, pay component) an agreement already recovered — do not exist, so
		// MEASURE selects by the arm rather than by subtraction.
		const obligationsByEmployment = groupBy(live(obligationRows), (row) => row.employment_id);
		/** Every approved leave row is already an event; normal requests become TAKEN movements while
		 * the adjustment/encashment arms carry their exact signed movement. */
		const leaveMovements: (LedgerRow & { readonly employment_id: string })[] = live(
			requestRows
		).map((request) => {
			const event = request.event;
			if (event == null) refuse(`Leave request ${request.id} has no event payload.`);
			if (event.kind === 'TIME_OFF')
				return {
					id: request.id,
					employment_id: request.employment_id,
					leave_type_id: request.leave_type_id,
					entry_date: event.range.start.date,
					kind: 'TAKEN',
					days: -Math.abs(Number(event.chargeable_days ?? 0)),
					source_id: request.id,
					approval_id: null
				};
			return {
				id: request.id,
				employment_id: request.employment_id,
				leave_type_id: request.leave_type_id,
				entry_date: event.effective_on,
				kind:
					event.kind === 'BALANCE_ADJUSTMENT'
						? 'ADJUSTMENT'
						: event.kind === 'ENCASHMENT'
							? 'ENCASHMENT'
							: 'TAKEN',
				days: Number(event.movement_days),
				source_id: event.source_id,
				approval_id: null
			};
		});
		const ledgerByEmployment = groupBy(leaveMovements, (row) => row.employment_id);
		const workDaysByEmployment = groupBy(live(workDayRows), (row) => row.employment_id);

		const bundles: EmploymentBundle[] = [];
		for (const employment of employments) {
			const employee = employeeById.get(employment.employee_id);
			if (!employee)
				refuse(`Employment ${employment.employee_number} has no approved employee record.`);
			const settlement = settlementByEmployment.get(employment.id);
			if (!settlement)
				refuse(`Employment ${employment.employee_number} was gathered without a settlement.`);
			const hire = dateKey(employment.hire_date);
			if (hire == null) refuse(`Employment ${employment.employee_number} has no hire date.`);
			const dob = dateKey(employee.date_of_birth);
			const statutoryFacts = factsByEmployment.get(employment.id) ?? [];
			bundles.push({
				employment,
				employee,
				terms: effectiveWithin(
					termsByEmployment.get(employment.id) ?? [],
					salary.start,
					salary.end
				),
				statutoryFacts,
				obligations: obligationsByEmployment.get(employment.id) ?? [],
				ledger: ledgerByEmployment.get(employment.id) ?? [],
				workDays: workDaysByEmployment.get(employment.id) ?? [],
				serviceMonths: completedMonths(hire, salary.end),
				age: dob == null ? null : completedYears(dob, salary.end),
				employedDays: settlement.employedDays,
				wageDays: settlement.wageDays,
				attendance: settlement.attendance,
				arrearsFor: settlement.arrearsFor,
				deferral: settlement.deferral,
				extendedLeaveSettlesInOwnMonth: inExtendedLeavePopulation({
					policy: options.policy,
					statutoryFacts,
					asOf: salary.end
				})
			});
		}

		return {
			bundles,
			// Headcount is who the run pays. A deferred joining period pays nobody, and counting it would
			// move a headcount-banded contribution for everyone else in the company.
			headcount: bundles.filter((bundle) => bundle.deferral == null).length,
			...(yield* gatherPriorSettlement({
				api: options.api,
				configuration: options.configuration,
				period,
				employeeIds,
				companyId
			}))
		};
	});
}

/**
 * Year-to-date statutory charges, and what earlier paid runs already took from each obligation.
 *
 * Two faults in the engine of record are fixed here, and both were verified to be safe against the
 * parity baseline before being changed:
 *
 * 1. **YTD is keyed on the employee, not the employment.** A transfer or a rehire creates a new
 *    employment, which zeroed the year-to-date mid-year and reset the PCB projection and both
 *    relief pools with it. The 2026 population has no transfers, so fixing it moves nothing today
 *    and stops misstating tax the first time someone moves (decision L34 / risk register #11).
 * 2. **Draft runs no longer count.** There was no lifecycle predicate at all, so an abandoned draft
 *    fed the next period's projection and nothing recomputed it when the draft was discarded. Only
 *    `PAID` runs are year-to-date (decision L35 / risk register #8).
 *
 * ## Year-to-date is a sum over payslips alone
 *
 * The statutory charges are inlined on the payslip, so the year-to-date figure is a jsonb
 * aggregation over rows this function already had in hand — it needs no second collection and no
 * join. What still needs a read is *consumption*, which lives on `payslip_adjustments`; that query
 * is narrowed to the `OBLIGATION` arm, because a work day or a leave request depletes nothing.
 */
type GatherPriorSettlementOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly configuration: Configuration;
	readonly period: string;
	readonly companyId: string;
	readonly employeeIds: readonly string[];
};

type PriorSettlement = {
	readonly yearToDate: Map<string, { employee: number; employer: number; base: number }>;
	readonly consumedObligations: Map<string, number>;
};

function gatherPriorSettlement(
	options: GatherPriorSettlementOptions
): Effect.Effect<PriorSettlement, never, never> {
	return Effect.gen(function* () {
		const db = options.api.db;
		const startMonth = Number(options.configuration.jurisdiction.tax_year_start_month);
		const firstPeriod = taxYearFirstPeriod(options.period, startMonth);
		/**
		 * Every earlier settled run, not only this tax year's.
		 *
		 * Year-to-date is a tax-year question and is still filtered as one below. What an obligation
		 * has repaid is not: a loan written in November is still being recovered in February, and
		 * reading only the current tax year would report its instalments as untouched and deduct them
		 * a second time. One read answers both questions; only the summing differs.
		 */
		const priorRunRows = yield* db.payroll_runs.findMany({
			where: {
				company_id: { eq: options.companyId },
				period: { lt: options.period },
				lifecycle: { eq: 'PAID' }
			},
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
		const totals = new Map<string, { employee: number; employer: number; base: number }>();
		const consumedObligations = new Map<string, number>();
		const empty = { yearToDate: totals, consumedObligations };
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

		const contributionCodeById = new Map(
			options.configuration.contributions.map((entry) => [entry.row.id, entry.row.code])
		);
		/**
		 * Year-to-date, summed off the payslips themselves.
		 *
		 * `payslips.statutory` holds one entry per scheme charged, with the employee share, the
		 * employer share and the wage they were charged on together on that entry. Pairing two rows
		 * by `statutory_contribution_id` and hoping neither half was missing is gone with the shape,
		 * and so is the base double-count guard: one entry per scheme per payslip means the base is
		 * stated once by construction.
		 */
		for (const payslip of priorPayslips) {
			if (!inTaxYear.has(payslip.payroll_run_id)) continue;
			const employeeId = employmentToEmployee.get(payslip.employment_id);
			if (employeeId == null) continue;
			for (const charge of payslip.statutory) {
				const code = contributionCodeById.get(charge.statutory_contribution_id);
				if (code == null) continue;
				const key = `${employeeId}:${code}`;
				const running = totals.get(key) ?? { employee: 0, employer: 0, base: 0 };
				totals.set(key, {
					employee: running.employee + Number(charge.employee_amount),
					employer: running.employer + Number(charge.employer_amount),
					base: running.base + Number(charge.base_amount)
				});
			}
		}

		/**
		 * What every earlier paid run took from each obligation.
		 *
		 * Summed rather than counted, because a row may hold less than the obligation asked for:
		 * SETTLE reduces a deduction that would have driven net below zero, and the reduced figure is
		 * what was actually taken. The difference is not written anywhere — it is simply still
		 * outstanding, and it is outstanding *here*, in the gap between the obligation and this sum.
		 *
		 * Narrowed to the `OBLIGATION` arm on the way out of the database: a work day or a leave
		 * request is a settlement claim, not a draw on a balance, and reading them would be reading a
		 * month of attendance to sum nothing.
		 */
		const consumption = yield* db.payslip_adjustments.findMany({
			where: {
				payslip_id: { in: priorPayslips.map((row) => row.id) },
				source: { kind: { eq: 'OBLIGATION' } }
			},
			columns: { source: true, amount: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(consumption, 'prior obligation adjustments');
		for (const row of consumption) {
			if (row.source.kind !== 'OBLIGATION') continue;
			consumedObligations.set(
				row.source.id,
				(consumedObligations.get(row.source.id) ?? 0) + Number(row.amount ?? 0)
			);
		}
		return { yearToDate: totals, consumedObligations };
	});
}
