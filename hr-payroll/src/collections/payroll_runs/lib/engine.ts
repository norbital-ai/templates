/**
 * The payroll run — eight steps, the same eight for every country, split at the only line that
 * matters: **what reads, and what decides.**
 *
 * ```
 *  create.prepare ─┬─ 1 PICK       resolve the governing configuration → configuration_hash
 *   the only I/O   └─ 3 GATHER     employments, terms, facts, component entries, loan repayments,
 *                                  leave, work days, and what earlier PAID runs already consumed
 *
 *  create.before  ─┬─ 2 VALIDATE   everything that can be wrong before a person is measured
 *   pure           ├─ 4 MEASURE    in component sequence: base, proration and adjustments
 *                  ├─ 5 ACCUMULATE every amount through the grid → contribution bases
 *                  ├─ 6 CONTRIBUTE each scheme in sequence: base → employee and employer amounts
 *                  ├─ 7 SETTLE     gross, total deductions, net, employer cost
 *                  └─ 8 GRAPH      the payslips, their captured inputs and their adjustments,
 *                                  returned rather than written
 * ```
 *
 * Step 5 never names EPF. Step 6 never names overtime. Neither knows Malaysia.
 *
 * ## Why there is no `persist`
 *
 * A `before` hook's return **is** the record, and it may carry the records that belong to it. So the
 * run and its entire result are one write, performed by the runtime as part of the create — not by
 * the engine, which has no `mutate` to call. That is the whole of what this replaces:
 *
 *  - `clearRunResults` — an included `many` relationship is the parent's complete desired state, so
 *    stating the payslips already removes the previous build's. A separate clear was a second
 *    statement doing what the first one does.
 *  - `persistPayslips` — the graph is returned, not written.
 *  - `persistShortfalls` and `persistDeferrals` — one facility call **per employee**, and the reason
 *    a 290-person run took eight minutes. Both wrote arrears: a second copy of a debt the source
 *    already records. What is still owed is derived from what earlier PAID runs actually took.
 *  - `buildingRuns` / `isBuildingRun` — the engine used to persist from `create.after`, which landed
 *    on `payroll_runs` as an ordinary DRAFT update, which `update.after` read as "recalculate", which
 *    re-entered the engine until the host refused with `nesting_limit_exceeded`. There is no write to
 *    re-enter on, so there is nothing to guard.
 *
 * Re-entry is idempotent by construction rather than by cleanup: the same approved inputs produce
 * the same graph, and stating that graph replaces whatever the last build produced.
 */

import { Clock, Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { accumulateBases } from './accumulate.js';
import { withReadLog, type PayrollReadApi, type ReadLog } from './api.js';
import { pickConfiguration, type Configuration } from './configuration.js';
import { contribute, type StatutoryFactStatus } from './contribute.js';
import { coversDate } from './effective.js';
import { gatherRun, type GatheredRun } from './gather.js';
import { dailyOvertimeHoursLimit, dailyTotalWorkLimit, measureEmployment } from './measure.js';
import { payProjection, periodGrammarFault, resolveWindow, type PayrollWindow } from './period.js';
import { payrollRunGraph, type PendingPayslip } from './graph.js';
import { settle } from './settle.js';
import {
	blockers,
	describeIssues,
	validateConfiguration,
	validateDailyOvertimeHoursLimit,
	validateDailyWorkLimit,
	validateOpenWorkDays,
	validateOvertimeLimits,
	validatePayCalendar,
	validateRosteredExpectations,
	rosteredWorkCodeMaps,
	type RunIssue
} from './validate.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { termPattern } from '../../../lib/scheduling/work-pattern.js';

/**
 * The engine/build identity stamped on every run this code produces.
 *
 * A configuration hash identifies data, not code: without a durable identity for the code that
 * interpreted it, the same captured configuration could be interpreted differently after an engine
 * change and leave nothing on the run to explain the difference. Bump this when the payroll
 * algorithm changes in a way a settled payslip's reader would need to know.
 */
export const CALCULATION_VERSION = '2026-09-frozen-monthly-supplements-carry' as const;

/** What one build produced, and what the run's `before` hook returns alongside its own columns. */
type PayrollRunGraph = {
	readonly payslip_payroll_run: ReturnType<typeof payrollRunGraph>;
	readonly payslipCount: number;
	/** Inlined base entries plus the proration segments behind them. */
	readonly baseCount: number;
	readonly adjustmentCount: number;
	/** Junction rows the run wrote — every captured input, zero-value ones included. */
	readonly capturedCount: number;
	readonly warnings: readonly string[];
};

/**
 * Resolve the window and the governing configuration without reading a single employee.
 *
 * Module-local: `gatherPayrollRun` below is its only caller. The hook used to import it to derive
 * the run's own columns before the build; it now asks for the whole prepared run instead, so the
 * export had no consumer left — which `bolt audit` refuses (EXP1), and rightly.
 */
function preparePayrollRun(options: {
	readonly api: PayrollReadApi;
	readonly companyId: string;
	readonly period: string;
}): Effect.Effect<{ window: PayrollWindow; configuration: Configuration }, never, never> {
	return Effect.gen(function* () {
		const api = withReadLog(options.api);
		const company = yield* api.db.companies.findFirst({
			where: { id: { eq: options.companyId }, approval_id: { isNull: true } }
		});
		if (!company) refuse(`Company ${options.companyId} does not exist.`);
		// The period is written in the company's grammar: months for a monthly company, halves for
		// a semi-monthly one. The wrong grammar is refused here, naming the company's frequency,
		// before a window is resolved or a single row is read.
		const fault = periodGrammarFault(options.period, company);
		if (fault != null) refuse(fault);
		const window = resolveWindow(options.period, company);
		const configuration = yield* pickConfiguration({
			api,
			companyId: options.companyId,
			window
		});
		return { window, configuration };
	});
}

/**
 * Everything one run reads, read once.
 *
 * This is the whole I/O surface of a payroll run. It is deliberately one function rather than reads
 * scattered through the phases: a run that reads while it calculates is a run whose figures depend
 * on when each query happened to land, and the only honest way to say "this result came from these
 * facts" is to have taken all of them first.
 */
export type PreparedRun = {
	readonly period: string;
	readonly window: PayrollWindow;
	readonly configuration: Configuration;
	readonly gathered: GatheredRun;
	readonly readLog: ReadLog;
};

export function gatherPayrollRun(options: {
	readonly api: PayrollReadApi;
	readonly companyId: string;
	readonly period: string;
}): Effect.Effect<PreparedRun, never, never> {
	return Effect.gen(function* () {
		const api = withReadLog(options.api);
		const t0 = yield* Clock.currentTimeMillis;
		const { window, configuration } = yield* preparePayrollRun(options);
		const pick = yield* Clock.currentTimeMillis;
		const gathered = yield* gatherRun({ api, configuration, window });
		const done = yield* Clock.currentTimeMillis;
		yield* Effect.log(
			`[payroll-phase] ${options.period} pick=${pick - t0}ms gather=${done - pick}ms ` +
				`| ${api.reads.logString()}`
		);
		return {
			period: options.period,
			window,
			configuration,
			gathered,
			readLog: api.reads
		};
	});
}

/**
 * Turn prepared facts into the run's complete result. Pure: no database, no clock, no writes.
 *
 * Every refusal in here happens before anything is written, because there is nothing to write with.
 * That is a stronger guarantee than the one it replaces — the old build ran in `create.after`, where
 * a refusal left a DRAFT run with no payslips standing as a record of a calculation that never
 * happened, and every one of those had to be found and deleted by hand.
 */
export function buildPayrollRun(prepared: PreparedRun): PayrollRunGraph {
	const { configuration, gathered, window, period } = prepared;

	// 2 — VALIDATE
	const issues: RunIssue[] = validateConfiguration(configuration);
	if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));

	// A cadence the company has written no calendar for stops the run here, before a single
	// employment is measured, so the operator reads the issue that names them rather than an
	// exception thrown out of `resolveWindow` five phases in.
	issues.push(...validatePayCalendar({ configuration, bundles: gathered.bundles }));
	// An open clock is caught here rather than three phases in, where `normalizedWorkedIntervals`
	// refuses it as an "invalid interval" — true, but a long way from the record at fault. Reported
	// as issues rather than thrown one at a time, so a month with thirty-six unclosed days yields
	// one list instead of thirty-six consecutive builds.
	issues.push(...validateOpenWorkDays({ bundles: gathered.bundles }));
	// Rostered employments carry no pattern day: their guaranteed or capped load is measured here,
	// over the pay window, with the same sentences precheck reports. A MONTHLY rostered employment
	// with zero expected days stops here rather than deriving ordinary hours from nothing.
	issues.push(
		...validateRosteredExpectations({
			period,
			window: window.attendance,
			employments: gathered.bundles.map((bundle) => ({
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
	if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));

	const pending: PendingPayslip[] = [];
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
		const measured = measureEmployment({
			bundle,
			configuration,
			period,
			salary: bundle.window.salary,
			periodsRemaining: projection.payslipsRemaining,
			headcount: gathered.headcount,
			consumedEntries: gathered.consumedEntries,
			consumedRepayments: gathered.consumedRepayments
		});

		for (const [calendarMonth, monthHours] of measured.calendarMonthOvertimeHours) {
			issues.push(
				...validateOvertimeLimits({
					configuration,
					employeeNumber: bundle.employment.employee_number,
					calendarMonth,
					monthHours
				})
			);
		}
		// The daily ceiling is the jurisdiction's, read from its regime where `period = 'DAY'`.
		// It used to be a literal 12 here, which meant Malaysia's cap was applied to every country in
		// the workspace. A jurisdiction that states no daily limit now has none enforced, rather than
		// inheriting one from a statute that does not govern it.
		const dailyWorkLimit = dailyTotalWorkLimit(configuration);
		if (dailyWorkLimit != null)
			issues.push(
				...validateDailyWorkLimit({
					employeeNumber: bundle.employment.employee_number,
					days: measured.overtimeDays,
					maxWorkHours: dailyWorkLimit
				})
			);
		const dailyOvertimeLimit = dailyOvertimeHoursLimit(configuration);
		if (dailyOvertimeLimit != null)
			issues.push(
				...validateDailyOvertimeHoursLimit({
					employeeNumber: bundle.employment.employee_number,
					days: measured.overtimeDays,
					maxOvertimeHours: dailyOvertimeLimit
				})
			);

		// 5 — ACCUMULATE
		//
		// Both planes at once. A contribution base is a fact about the payslip, so which table an
		// amount will be stored in cannot change what it is charged on; proration is deliberately
		// absent, because it is the working behind a base amount and charging it would double the
		// wage.
		const bases = accumulateBases({
			configuration,
			items: [...measured.base, ...measured.adjustments],
			employeeNumber: bundle.employment.employee_number
		});

		// 6 — CONTRIBUTE
		const facts = new Map<string, StatutoryFactStatus>();
		const statutoryAsOf = bundle.employedDays?.end ?? window.salary.end;
		for (const fact of bundle.statutoryFacts) {
			// A leaver's registration remains authoritative through their actual final day. Testing
			// the calendar month's end instead would make every fact look expired and silently fall
			// back to the scheme default during final pay.
			if (!coversDate(fact.effective_range, statutoryAsOf)) continue;
			const status = fact.status;
			if (status == null) continue;
			facts.set(fact.statutory_contribution_id, {
				kind: status.kind,
				rate_override: status.kind === 'REGISTERED' ? status.rate_override : null
			});
		}
		const charges = contribute({
			bases,
			facts,
			yearToDate: (code) =>
				gathered.yearToDate.get(`${bundle.employment.employee_id}:${code}`) ?? {
					employee: 0,
					employer: 0,
					base: 0
				},
			age: bundle.age,
			headcount: gathered.headcount,
			riskClass: configuration.company.risk_class,
			projection,
			// The relief and the married scale turn on whether the spouse has income, not on
			// `marital_status` — see employees.spouse_status.
			spouseIsDependent: bundle.employee.spouse_status === 'WITHOUT_INCOME',
			dependents: decodeNumber(bundle.employee.dependents_count ?? 0)
		});

		// 7 — SETTLE
		//
		// A deduction the guard could not take is not carried anywhere. The adjustment records what
		// was actually taken, and the difference between that and the source is what remains owed
		// — derived by the next run from these very rows, never copied into one.
		const settlement = settle({
			base: measured.base,
			adjustments: measured.adjustments,
			charges
		});

		pending.push({
			employmentId: bundle.employment.id,
			currency: measured.currency,
			settlement,
			// Evidence, not money: the segments explain the base amounts, and the negative-net guard
			// only ever touches deductions.
			proration: measured.proration,
			charges,
			// The captured inputs: every source the run read, whether or not it produced money. The
			// junction rows are the settlement lock, so zero-value sources ride with the payslip too.
			captured: measured.captured
		});
	}

	// Nothing is returned until every employment has been measured, so a run that breaches an
	// hours-of-work limit for one person on one day produces no payslip for anybody. That is the
	// point: a payroll is published whole or not at all, and the operator is told which person and
	// which day.
	const blocking = blockers(issues);
	if (blocking.length > 0) refuse(describeIssues(blocking));

	// 8 — GRAPH
	const graph = payrollRunGraph({ pending, period });
	const adjustments = graph.flatMap((payslip) => payslip.payslip_adjustment_payslip);
	return {
		payslip_payroll_run: graph,
		payslipCount: pending.length,
		baseCount: graph.reduce(
			(total, payslip) => total + payslip.base.length + payslip.proration.length,
			0
		),
		adjustmentCount: adjustments.length,
		// Junction rows, counted separately so the run log distinguishes "captured and priced at
		// nothing" from "produced money". A source that calculated to zero was still consumed and is
		// still locked — by its junction row, never by a zero-amount output.
		capturedCount: graph.reduce(
			(total, payslip) =>
				total +
				payslip.payslip_work_day_input_payslip.length +
				payslip.payslip_component_entry_input_payslip.length +
				payslip.payslip_leave_request_input_payslip.length +
				payslip.payslip_loan_repayment_input_payslip.length,
			0
		),
		warnings: issues
			.filter((issue) => issue.severity === 'WARNING')
			.map((issue) => describeIssues([issue], 'warn'))
	};
}
