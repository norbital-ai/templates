import { calculateFamilyAssessments } from '../../../lib/payroll/families.js';
/**
 * The payroll run — eight steps, the same eight for every country, split at the only line that
 * matters: **what reads, and what decides.**
 *
 * ```
 *  gather         ─┬─ 1 PICK       resolve the governing configuration → configuration_hash
 *   the only I/O   └─ 3 GATHER     employments, terms, facts, component entries, loan repayments,
 *   (two waves,                    leave, work days, and what earlier PAID runs already consumed
 *    lib/preload.ts)
 *
 *  build          ─┬─ 2 VALIDATE   everything that can be wrong before a person is measured
 *   pure           ├─ 4 MEASURE    in the family pipeline order: base, proration and adjustments
 *                  ├─ 5 ACCUMULATE every amount through the grid → contribution bases
 *                  ├─ 6 CONTRIBUTE each scheme in dependency order: base → employee and employer amounts
 *                  ├─ 7 SETTLE     gross, total deductions, net, employer cost
 *                  └─ 8 GRAPH      the payslips, their captured inputs and their adjustments,
 *                                  returned rather than written
 * ```
 *
 * Step 5 never names EPF. Step 6 never names overtime. Neither knows Malaysia.
 *
 * ## Why there is no `persist`
 *
 * The run's transform returns the record, and the record carries the records that belong to it.
 * So the run and its entire result are one write, performed by the runtime as part of the create —
 * not by the engine, which has nothing to write with. That is the whole of what this replaces:
 *
 *  - `persistPayslips` — the payload is returned, not written.
 *  - `persistShortfalls` and `persistDeferrals` — one facility call **per employee**, and the reason
 *    a 290-person run took eight minutes. Both wrote arrears: a second copy of a debt the source
 *    already records. What is still owed is derived from what earlier PAID runs actually took.
 *  - the capture writers — the pins on every consumed source are `link` actions on the payslip
 *    that consumed it, committed in the same transaction as the run.
 *
 * Re-entry is idempotent by construction rather than by cleanup: the same approved inputs produce
 * the same payload.
 */

import { Clock, Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { withReadLog, type PayrollReadApi, type ReadLog } from './api.js';
import { pickConfiguration, type Configuration } from './configuration.js';
import { gatherRun, type GatheredRun } from './gather.js';
import { periodGrammarFault, resolveWindow, type PayrollWindow } from './period.js';
import { payrollRunGraph, type PendingPayslip } from './graph.js';
import { settle } from './settle.js';
import { isFinalPayslip, loanShortfallIssues } from '../../../lib/payroll/loan.js';
import {
	finalPayIssues,
	minimumWageIssues,
	windowMinimumWage
} from '../../../lib/payroll/contribution.js';
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
export const CALCULATION_VERSION = '2026-09-statutory-funding' as const;

/** What one build produced, and what the run's transform returns alongside its own columns. */
type PayrollRunGraph = {
	readonly payslip_payroll_run: ReturnType<typeof payrollRunGraph>['rows'];
	/** The COMPANY-assessed schemes' charges: one row for the run, on no payslip. */
	readonly company_charges: readonly {
		readonly scheme_code: string;
		readonly authority: string | null;
		readonly base_amount: number;
		readonly employee_amount: number;
		readonly employer_amount: number;
		readonly rule_when: string | null;
	}[];
	/** How every charge was derived, stored whole on the run for the Flow screen. */
	readonly calculation_trace: ReturnType<typeof payrollRunGraph>['calculationTrace'];
	/** What each payslip settled; `payrollRunPayload` turns it into the slip's relation actions. */
	readonly captures: ReturnType<typeof payrollRunGraph>['captures'];
	readonly payslipCount: number;
	/** Inlined base entries plus the proration segments behind them. */
	readonly baseCount: number;
	readonly adjustmentCount: number;
	/** Every captured input, zero-value ones included. */
	readonly capturedCount: number;
	readonly warnings: readonly string[];
};

/**
 * Resolve the window and the governing configuration without reading a single employee.
 *
 * Module-local: `gatherPayrollRun` below is its only caller.
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
		const facts = yield* gatherRun({
			api,
			configuration,
			window
		});
		const done = yield* Clock.currentTimeMillis;
		yield* Effect.log(
			`[payroll-phase] ${options.period} pick=${pick - t0}ms gather=${done - pick}ms ` +
				`| ${api.reads.logString()}`
		);
		return {
			period: options.period,
			window,
			configuration,
			gathered: facts,
			readLog: api.reads
		};
	});
}

/**
 * Turn prepared facts into the run's complete result. Pure: no database, no clock, no writes.
 *
 * Every refusal in here happens before anything is written, because there is nothing to write with.
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
		companyCharges,
		issues: familyIssues
	} = calculateFamilyAssessments({ configuration, gathered, window, period });
	issues.push(...familyIssues);
	issues.push(
		...minimumWageIssues({ configuration, bundles: gathered.bundles, asOf: window.salary.end }),
		...finalPayIssues({ configuration, bundles: gathered.bundles, payDate: window.payDate })
	);
	// A rule that charges without a fact the law gives no default for says so: the run pays, and
	// the operator reads whose record to complete.
	for (const charge of companyCharges)
		for (const message of charge.warnings ?? [])
			issues.push({ code: 'CONTRIBUTION_RULE_WARNING', severity: 'WARNING', message });
	for (const { employment, measured, termsThrough } of measuredContracts) {
		const charges = chargesByEmployment.get(employment.id)!;
		for (const charge of charges)
			for (const message of charge.warnings ?? [])
				issues.push({
					code: 'CONTRIBUTION_RULE_WARNING',
					severity: 'WARNING',
					message: `${employment.employee_number}: ${message}`,
					collection: 'employments',
					recordId: employment.id
				});
		if (
			measured.bundle.deferral != null &&
			charges.every((charge) => charge.employee === 0 && charge.employer === 0)
		)
			continue;
		// 7 — SETTLE
		//
		// A recovery the guard dropped is not carried anywhere: its repayment row stays unlinked
		// and the next run recovers it whole.
		const settlement = settle({
			base: measured.base,
			adjustments: measured.adjustments,
			charges,
			currency: measured.currency,
			employeeNumber: String(employment.employee_number),
			ceiling: configuration.jurisdiction.payroll.deduction_ceiling,
			finalPay: isFinalPayslip(measured.bundle)
		});
		const recovered = new Set(
			settlement.adjustments
				.filter((row) => row.input.family === 'LOAN_REPAYMENT')
				.map((row) => row.input.id)
		);
		if (settlement.unfundedContributions > 0)
			issues.push({
				code: 'STATUTORY_FUNDING_REQUIRED',
				severity: 'WARNING',
				collection: 'employments',
				recordId: employment.id,
				message: `${employment.employee_number}: employee statutory contributions of ${settlement.unfundedContributions} ${measured.currency} remain unfunded. Arrange and reconcile funding separately; later payroll does not automatically recover this amount.`
			});
		// A deduction the law forbids is not the run's to shorten: the operator resolves it.
		if (settlement.ceilingExcess > 0)
			issues.push({
				code: 'DEDUCTION_CEILING_EXCEEDED',
				collection: 'employments',
				recordId: employment.id,
				message: `${employment.employee_number}: deductions exceed the lawful ceiling by ${settlement.ceilingExcess} ${measured.currency} (${configuration.jurisdiction.payroll.deduction_ceiling?.authority}). Reduce or defer the deduction, or withhold this person from the run.`
			});
		// What the guard could not take is a fact about the month, not a rounding: an agreement with
		// a stated minimum blocks here, one without it warns. Nothing read `shortfalls` before.
		issues.push(
			...loanShortfallIssues({
				employeeNumber: String(employment.employee_number),
				employmentId: employment.id,
				loans: measured.bundle.loans,
				settlement
			})
		);

		pending.push({
			employmentId: employment.id,
			employeeNumber: String(employment.employee_number),
			termsThrough,
			currency: measured.currency,
			settlement,
			// Evidence, not money: the segments explain the base amounts, and the negative-net guard
			// only ever touches deductions.
			proration: measured.proration,
			charges,
			settledOvertimeHours: measured.settledOvertimeHours,
			inLieuSlices: measured.inLieuSlices,
			overtimeDays: measured.periodOvertimeDays,
			minimumWage: windowMinimumWage(
				configuration,
				measured.bundle.employedDays ?? measured.bundle.window.salary
			),
			// The captured inputs: every source the run read, whether or not it produced money. The
			// pins are the settlement lock, so zero-value sources ride with the payslip too — except a
			// repayment the guard dropped, which no slip recovered.
			captured: {
				...measured.captured,
				loanRepayments: measured.captured.loanRepayments.filter((id) => recovered.has(id))
			}
		});
	}

	// Nothing is returned until every employment has been measured, so a run that breaches an
	// hours-of-work limit for one person on one day produces no payslip for anybody. That is the
	// point: a payroll is published whole or not at all, and the operator is told which person and
	// which day.
	const blocking = blockers(issues);
	if (blocking.length > 0) refuse(describeIssues(blocking));

	// 8 — GRAPH
	const { rows: graph, captures, calculationTrace } = payrollRunGraph({ pending, period });
	return {
		payslip_payroll_run: graph,
		company_charges: companyCharges.map((charge) => ({
			scheme_code: charge.contribution.row.code,
			authority: charge.contribution.row.authority,
			label: charge.contribution.row.short_name ?? null,
			listing_order: charge.contribution.row.listing_order ?? null,
			listing_group: charge.contribution.row.listing_group ?? null,
			base_amount: charge.base,
			employee_amount: charge.employee,
			employer_amount: charge.employer,
			rule_when: charge.ruleReference
		})),
		calculation_trace: calculationTrace,
		captures,
		payslipCount: pending.length,
		baseCount: graph.reduce(
			(total, payslip) => total + payslip.base.length + payslip.proration.length,
			0
		),
		adjustmentCount: graph.reduce((total, payslip) => total + payslip.adjustments.length, 0),
		// Captures, counted separately so the run log distinguishes "captured and priced at nothing"
		// from "produced money". A source that calculated to zero was still consumed and is still
		// locked — by its settled payslip, never by a zero-amount output.
		capturedCount: captures.reduce(
			(total, capture) =>
				total +
				capture.workDays.length +
				capture.claims.length +
				capture.leave.length +
				capture.loanRepayments.length,
			0
		),
		warnings: issues
			.filter((issue) => issue.severity === 'WARNING')
			.map((issue) => `${issue.code}: ${issue.message}`)
	};
}
