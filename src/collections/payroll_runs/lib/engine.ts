import {
	calculateFamilyAssessments,
	finalizeFamilyConfiguration
} from '../../../lib/payroll/families.js';
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
import { withReadLog, type PayrollReadApi, type ReadLog } from './api.js';
import { pickConfiguration, type Configuration } from './configuration.js';
import { gatherRun, type GatheredRun } from './gather.js';
import { periodGrammarFault, resolveWindow, type PayrollWindow } from './period.js';
import { payrollRunGraph, type PendingPayslip } from './graph.js';
import { settle } from './settle.js';
import {
	blockers,
	describeIssues,
	validateConfiguration,
	validatePayCalendar,
	type RunIssue
} from './validate.js';

/**
 * The engine/build identity stamped on every run this code produces.
 *
 * A configuration hash identifies data, not code: without a durable identity for the code that
 * interpreted it, the same captured configuration could be interpreted differently after an engine
 * change and leave nothing on the run to explain the difference. Bump this when the payroll
 * algorithm changes in a way a settled payslip's reader would need to know.
 */
export const CALCULATION_VERSION = '2026-09-contract-payroll-families' as const;

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
		const facts = yield* gatherRun({ api, configuration, window });
		const { configuration: preparedConfiguration, gathered } = finalizeFamilyConfiguration(
			configuration,
			facts,
			window
		);
		const done = yield* Clock.currentTimeMillis;
		yield* Effect.log(
			`[payroll-phase] ${options.period} pick=${pick - t0}ms gather=${done - pick}ms ` +
				`| ${api.reads.logString()}`
		);
		return {
			period: options.period,
			window,
			configuration: preparedConfiguration,
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

	if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));

	const pending: PendingPayslip[] = [];
	const {
		measuredContracts,
		chargesByEmployment,
		issues: familyIssues
	} = calculateFamilyAssessments({ configuration, gathered, window, period });
	issues.push(...familyIssues);
	for (const { employment, measured, termsThrough } of measuredContracts) {
		const charges = chargesByEmployment.get(employment.id)!;
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
			employmentId: employment.id,
			termsThrough,
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
				payslip.payslip_claim_request_input_payslip.length +
				payslip.payslip_allowance_request_input_payslip.length +
				payslip.payslip_payment_request_input_payslip.length +
				payslip.payslip_leave_input_payslip.length +
				payslip.payslip_loan_repayment_input_payslip.length,
			0
		),
		warnings: issues
			.filter((issue) => issue.severity === 'WARNING')
			.map((issue) => describeIssues([issue], 'warn'))
	};
}
