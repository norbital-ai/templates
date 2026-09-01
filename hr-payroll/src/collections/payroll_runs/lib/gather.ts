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
 * way at all to record that a row *had* been consumed. Consumption is now a captured input: the
 * engine writes a row in one of the four `payslip_*_inputs` junctions, and that row is the
 * settlement lock. Deliberately not here: a source this run settled must still be readable by this
 * run's next rebuild, so a captured input is not, and must never become, a filter on these queries.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { entryAlreadyCapturedMessage } from '../../../lib/settlement_refusals.js';
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
import {
	depletes,
	entryEvent,
	type ComponentEntry,
	type Loan,
	type LoanRepayment
} from './entries.js';
import { effectiveWithin, live, overlapsRange } from './effective.js';
import type { ChildFact, LedgerRow } from './leave.js';
import { taxYearFirstPeriod, taxYearOf, type PayrollWindow } from './period.js';
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
	/** Claims, standing allowances, bonuses, arrears settlements and corrections. */
	readonly componentEntries: readonly ComponentEntry[];
	/** The employment's child facts — the input a child-scaled statutory leave floor reads. */
	readonly children: readonly ChildFact[];
	/** The loan agreements this employment carries. Payroll consumes their repayments, not these. */
	readonly loans: readonly Loan[];
	/** The amounts due under those agreements — one of the four input families. */
	readonly loanRepayments: readonly LoanRepayment[];
	readonly ledger: readonly LedgerRow[];
	/** Plan and punch together. */
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
	 * persistence into base pay for the deferred period instead of a payslip.
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
	 * `component_entry_id` → what earlier PAID runs actually took from it.
	 *
	 * A one-off entry is single-use — one standing/paid payslip captures it, and the guard below
	 * refuses a second — so this map is the defence-in-depth ceiling rather than the working answer.
	 * The cap arithmetic inside the one capturing payslip is where a claim settles for less than it
	 * asked for, and a capped claim leaves no invented balance behind.
	 */
	readonly consumedEntries: ReadonlyMap<string, number>;
	/**
	 * `loan_repayment_id` → what earlier PAID runs actually recovered from it.
	 *
	 * A repayment may legitimately feed several payslips — net-pay protection can part-recover it —
	 * so this is the cross-run ceiling the database does not hold: paid recovery across every
	 * payslip may never exceed the repayment's amount due. This is what replaces carried-forward
	 * arrears entirely; nothing is written down as outstanding, because what is outstanding is
	 * exactly `amount_due` minus this sum, re-derived on every build.
	 */
	readonly consumedRepayments: ReadonlyMap<string, number>;
};

/** What `gatherRun` needs: the reads, the picked law, the window and the settlement policy. */
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
			return {
				bundles: [],
				headcount: 0,
				yearToDate: new Map(),
				consumedEntries: new Map(),
				consumedRepayments: new Map()
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
		const inEmployments = { employment_id: { in: employmentIds }, ...approved } as const;

		const [
			employeeRows,
			termRows,
			factRows,
			entryRows,
			loanRows,
			requestRows,
			workDayRows,
			childRows
		] = yield* Effect.all(
			[
				db.employees.findMany({
					where: { id: { in: employeeIds }, ...approved },
					limit: PAGE_LIMIT
				}),
				db.employment_terms.findMany({ where: inEmployments, limit: PAGE_LIMIT }),
				db.employment_statutory_facts.findMany({ where: inEmployments, limit: PAGE_LIMIT }),
				db.component_entries.findMany({ where: inEmployments, limit: PAGE_LIMIT }),
				db.loans.findMany({ where: inEmployments, limit: PAGE_LIMIT }),
				db.leave_requests.findMany({ where: inEmployments, limit: PAGE_LIMIT }),
				db.work_days.findMany({
					where: {
						employment_id: { in: employmentIds },
						work_date: { gte: complianceSpan.start, lte: complianceSpan.end },
						...approved
					},
					limit: PAGE_LIMIT
				}),
				db.employee_children.findMany({
					where: { employment_id: { in: employmentIds } },
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
		options.api.reads.assertComplete(entryRows, 'component entries');
		options.api.reads.assertComplete(loanRows, 'loans');
		options.api.reads.assertComplete(requestRows, 'leave requests');
		options.api.reads.assertComplete(workDayRows, 'work days');
		options.api.reads.assertComplete(childRows, 'child facts');

		// The loan's schedule is read directly, in one query over every agreement just read. The
		// removed `obligations` model copied the schedule into money rows so payroll could find them;
		// the schedule owning its own rows is what makes that copy unnecessary.
		const loanIds = [...new Set(live(loanRows).map((row) => row.id))];
		const repaymentRows =
			loanIds.length > 0
				? yield* db.loan_repayments.findMany({
						where: { loan_id: { in: loanIds } },
						limit: PAGE_LIMIT
					})
				: [];
		options.api.reads.assertComplete(repaymentRows, 'loan repayments');

		const employeeById = new Map(live(employeeRows).map((row) => [row.id, row]));
		const termsByEmployment = groupBy(live(termRows), (row) => row.employment_id);
		const factsByEmployment = groupBy(live(factRows), (row) => row.employment_id);
		const entriesByEmployment = groupBy(live(entryRows), (row) => row.employment_id);
		const repaymentsByLoan = groupBy(live(repaymentRows), (row) => row.loan_id);
		const loansByEmployment = groupBy(live(loanRows), (row) => row.employment_id);
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
		const childrenByEmployment = groupBy(live(childRows), (row) => row.employment_id);

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
			const employmentLoans = loansByEmployment.get(employment.id) ?? [];
			bundles.push({
				employment,
				employee,
				terms: effectiveWithin(
					termsByEmployment.get(employment.id) ?? [],
					salary.start,
					salary.end
				),
				statutoryFacts,
				componentEntries: entriesByEmployment.get(employment.id) ?? [],
				children: childrenByEmployment.get(employment.id) ?? [],
				loans: employmentLoans,
				loanRepayments: employmentLoans.flatMap((loan) => repaymentsByLoan.get(loan.id) ?? []),
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

		yield* refuseAlreadyCapturedEntries({
			api: options.api,
			entries: live(entryRows),
			period
		});

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
 * A one-off entry is captured by at most one standing payroll, and this is where that is refused.
 *
 * The junction rows are the capture: any row over these entries names a run that still stands
 * (deleting a draft releases its captures, so a standing junction is a live one). The period being
 * rebuilt is exempt — a recalculation replaces its own graph, and the replacement is one statement.
 * A standing allowance is exempt because it states an amount per period and is meant to feed every
 * period its range covers.
 */
type RefuseAlreadyCapturedEntriesOptions = {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly entries: readonly ComponentEntry[];
	readonly period: string;
};

function refuseAlreadyCapturedEntries(
	options: RefuseAlreadyCapturedEntriesOptions
): Effect.Effect<void, never, never> {
	const oneOffIds = options.entries
		.filter((entry) => depletes(entry) && entryEvent(entry) != null)
		.map((entry) => entry.id);
	if (oneOffIds.length === 0) return Effect.void;
	return Effect.gen(function* () {
		const db = options.api.db;
		const captures = yield* db.payslip_component_entry_inputs.findMany({
			where: { component_entry_id: { in: oneOffIds } },
			columns: { component_entry_id: true, payslip_id: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(captures, 'component-entry captures');
		if (captures.length === 0) return;
		const holdingPayslips = yield* db.payslips.findMany({
			where: { id: { in: captures.map((row) => row.payslip_id) } },
			columns: { id: true, payroll_run_id: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(holdingPayslips, 'capturing payslips');
		const runIds = [...new Set(holdingPayslips.map((row) => row.payroll_run_id))];
		const holdingRuns = yield* db.payroll_runs.findMany({
			where: { id: { in: runIds } },
			columns: { id: true, period: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(holdingRuns, 'capturing runs');
		const periodByRun = new Map(holdingRuns.map((row) => [row.id, row.period]));
		for (const capture of captures) {
			const payslip = holdingPayslips.find((row) => row.id === capture.payslip_id);
			const capturePeriod = payslip == null ? null : periodByRun.get(payslip.payroll_run_id);
			if (capturePeriod == null || capturePeriod === options.period) continue;
			refuse(entryAlreadyCapturedMessage({ capturedBy: capturePeriod, period: options.period }));
		}
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
 * 2. **Draft runs no longer count.** There was no lifecycle predicate at all, so an abandoned draft
 *    fed the next period's projection and nothing recomputed it when the draft was discarded. Only
 *    `PAID` runs are year-to-date (decision L35 / risk register #8).
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
	readonly yearToDate: Map<string, { employee: number; employer: number; base: number }>;
	readonly consumedEntries: Map<string, number>;
	readonly consumedRepayments: Map<string, number>;
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
		 * Year-to-date is a tax-year question and is still filtered as one below. What a loan
		 * repayment has repaid is not: a loan written in November is still being recovered in
		 * February, and reading only the current tax year would report its repayments as untouched and
		 * deduct them a second time. One read answers both questions; only the summing differs.
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
		const consumedEntries = new Map<string, number>();
		const consumedRepayments = new Map<string, number>();
		const empty = { yearToDate: totals, consumedEntries, consumedRepayments };
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
		const priorPayslipIds = priorPayslips.map((row) => row.id);

		const contributionCodeById = new Map(
			options.configuration.contributions.map((entry) => [entry.row.id, entry.row.code])
		);
		/**
		 * Year-to-date, summed off the payslips themselves.
		 *
		 * `payslips.statutory` holds one entry per scheme charged, with the employee share, the
		 * employer share and the wage they were charged on together on that entry. The scheme is
		 * named by its code — a frozen output carries a code, not a naked id — so there is no
		 * id-to-code join left at all.
		 */
		for (const payslip of priorPayslips) {
			if (!inTaxYear.has(payslip.payroll_run_id)) continue;
			const employeeId = employmentToEmployee.get(payslip.employment_id);
			if (employeeId == null) continue;
			for (const charge of payslip.statutory) {
				const key = `${employeeId}:${charge.scheme_code}`;
				const running = totals.get(key) ?? { employee: 0, employer: 0, base: 0 };
				totals.set(key, {
					employee: running.employee + Number(charge.employee_amount),
					employer: running.employer + Number(charge.employer_amount),
					base: running.base + Number(charge.base_amount)
				});
			}
		}

		/**
		 * What every earlier paid run took from each depleting source.
		 *
		 * Summed rather than counted, because a row may hold less than the source asked for: SETTLE
		 * reduces a deduction that would have driven net below zero, and the reduced figure is what
		 * was actually taken. The difference is not written anywhere — it is simply still
		 * outstanding, and it is outstanding *here*, in the gap between the source and this sum.
		 *
		 * The captured inputs are read first and the claims scoped by them, because an adjustment
		 * names a junction row, and the junction row names the business source. Two arms only: a work
		 * day or a leave request is a settlement claim, not a draw on a balance, and reading them
		 * would be reading a month of attendance to sum nothing.
		 */
		const entryLinks = yield* db.payslip_component_entry_inputs.findMany({
			where: { payslip_id: { in: priorPayslipIds } },
			columns: { id: true, component_entry_id: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(entryLinks, 'prior component-entry captures');
		const repaymentLinks = yield* db.payslip_loan_repayment_inputs.findMany({
			where: { payslip_id: { in: priorPayslipIds } },
			columns: { id: true, loan_repayment_id: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(repaymentLinks, 'prior loan-repayment captures');
		const entryIdByLink = new Map(entryLinks.map((row) => [row.id, row.component_entry_id]));
		const repaymentIdByLink = new Map(repaymentLinks.map((row) => [row.id, row.loan_repayment_id]));

		const entryClaims = yield* db.payslip_adjustments.findMany({
			where: {
				payslip_id: { in: priorPayslipIds },
				input: { kind: { eq: 'COMPONENT_ENTRY_INPUT' } }
			},
			columns: { input: true, amount: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(entryClaims, 'prior component-entry adjustments');
		for (const row of entryClaims) {
			if (row.input.kind !== 'COMPONENT_ENTRY_INPUT') continue;
			const sourceId = entryIdByLink.get(row.input.id);
			if (sourceId == null) continue;
			consumedEntries.set(sourceId, (consumedEntries.get(sourceId) ?? 0) + Number(row.amount ?? 0));
		}

		const repaymentClaims = yield* db.payslip_adjustments.findMany({
			where: {
				payslip_id: { in: priorPayslipIds },
				input: { kind: { eq: 'LOAN_REPAYMENT_INPUT' } }
			},
			columns: { input: true, amount: true },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(repaymentClaims, 'prior loan-recovery adjustments');
		for (const row of repaymentClaims) {
			if (row.input.kind !== 'LOAN_REPAYMENT_INPUT') continue;
			const sourceId = repaymentIdByLink.get(row.input.id);
			if (sourceId == null) continue;
			consumedRepayments.set(
				sourceId,
				(consumedRepayments.get(sourceId) ?? 0) + Number(row.amount ?? 0)
			);
		}

		return { yearToDate: totals, consumedEntries, consumedRepayments };
	});
}
