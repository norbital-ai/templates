/**
 * The payroll run — eight steps, the same eight for every country, split at the only line that
 * matters: **what reads, and what decides.**
 *
 * ```
 *  create.prepare ─┬─ 1 PICK       resolve the governing configuration → configuration_hash
 *   the only I/O   └─ 3 GATHER     employments, terms, facts, entries, leave, time, roster,
 *                                  agreements, and what earlier PAID runs already settled
 *
 *  create.before  ─┬─ 2 VALIDATE   everything that can be wrong before a person is measured
 *   pure           ├─ 4 MEASURE    in component-type sequence, produce amounts
 *                  ├─ 5 ACCUMULATE each line through the grid → contribution bases
 *                  ├─ 6 CONTRIBUTE each scheme in sequence: base → employee and employer amounts
 *                  ├─ 7 SETTLE     gross, total deductions, net, employer cost
 *                  └─ 8 GRAPH      the payslips, their lines and their settlement locks,
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
 *    a 290-person run took eight minutes. Both wrote arrears: a second copy of a debt the agreement
 *    already records. What is still owed is now derived from what earlier runs actually took.
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
import { claimsForBundle } from './claims.js';
import { withReadLog, type PayrollReadApi, type ReadLog } from './api.js';
import { pickConfiguration, type Configuration } from './configuration.js';
import { contribute, type StatutoryFactStatus } from './contribute.js';
import { coversDate } from './effective.js';
import { gatherRun, type GatheredRun } from './gather.js';
import { dailyTotalWorkLimit, measureEmployment } from './measure.js';
import {
	PAY_FREQUENCIES,
	payPeriodsRemaining,
	resolveWindow,
	type PayFrequency,
	type PayrollWindow
} from './period.js';
import { payrollRunGraph, type PendingPayslip } from './graph.js';
import { settle } from './settle.js';
import { readSettlementPolicy, type SettlementPolicy } from './settlement.js';
import {
	blockers,
	describeIssues,
	validateConfiguration,
	validateDailyWorkLimit,
	validateOpenTimeEntries,
	validateOvertimeLimits,
	validatePayCalendar,
	type RunIssue
} from './validate.js';

/**
 * The cadence an employment is paid on, as of the day the period closes.
 *
 * A mid-month change of terms is two rows, and the one in force at the end of the period is the one
 * whose cadence the run pays on — the same rule `measure.ts` applies to every other term. Terms
 * that state no frequency resolve to monthly here so the window can still be built; `measure.ts`
 * refuses them by name a step later, which is the message worth showing.
 */
function employmentPayFrequency(
	terms: readonly { readonly pay_frequency: string | null; readonly effective_range: unknown }[],
	asOf: string
): PayFrequency {
	const row =
		terms.find((candidate) => coversDate(candidate.effective_range, asOf)) ?? terms.at(-1);
	const stated = PAY_FREQUENCIES.find((candidate) => candidate === row?.pay_frequency);
	return stated ?? 'MONTHLY';
}

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
	readonly policy: SettlementPolicy;
	readonly gathered: GatheredRun;
	readonly periodsRemaining: number;
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
		const policy = readSettlementPolicy(configuration.company);
		const gathered = yield* gatherRun({ api, configuration, window, policy });
		const done = yield* Clock.currentTimeMillis;
		yield* Effect.log(
			`[payroll-phase] ${options.period} pick=${pick - t0}ms gather=${done - pick}ms ` +
				`| ${api.reads.logString()}`
		);
		return {
			period: options.period,
			window,
			configuration,
			policy,
			gathered,
			/**
			 * A count of **payslips**, not of pay events.
			 *
			 * One run settles the whole period — every instalment of it — in one payslip carrying a
			 * month's wages, on every cadence. A semi-monthly employment is paid twice a month in the
			 * real world and twenty-four times before a January tax year is out, but it receives the
			 * same twelve payslips this figure is multiplied against, so this is the same number for
			 * both cadences and deliberately so. `payPeriodsRemaining` states why at length.
			 */
			periodsRemaining: payPeriodsRemaining(
				options.period,
				Number(configuration.jurisdiction.tax_year_start_month)
			),
			readLog: api.reads
		};
	});
}

/** What one build produced, and what the run's `before` hook returns alongside its own columns. */
type PayrollRunGraph = {
	readonly payslip_payroll_run: ReturnType<typeof payrollRunGraph>;
	readonly payslipCount: number;
	readonly lineCount: number;
	readonly claimCount: number;
	readonly warnings: readonly string[];
};

/**
 * Turn prepared facts into the run's complete result. Pure: no database, no clock, no writes.
 *
 * Every refusal in here happens before anything is written, because there is nothing to write with.
 * That is a stronger guarantee than the one it replaces — the old build ran in `create.after`, where
 * a refusal left a DRAFT run with no payslips standing as a record of a calculation that never
 * happened, and every one of those had to be found and deleted by hand.
 */
export function buildPayrollRun(prepared: PreparedRun): PayrollRunGraph {
	const { configuration, gathered, window, period, policy } = prepared;

	// 2 — VALIDATE
	const issues: RunIssue[] = validateConfiguration(configuration);
	if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));

	// A cadence the company has written no calendar for stops the run here, before a single
	// employment is measured, so the operator reads the issue that names them rather than an
	// exception thrown out of `resolveWindow` five phases in.
	issues.push(...validatePayCalendar({ configuration, bundles: gathered.bundles }));
	// An open clock is caught here rather than three phases in, where `normalizedWorkedIntervals`
	// refuses it as an "invalid interval" — true, but a long way from the record at fault. Reported
	// as issues rather than thrown one at a time, so a month with thirty-six unclosed entries
	// yields one list instead of thirty-six consecutive builds.
	issues.push(...validateOpenTimeEntries({ bundles: gathered.bundles }));
	if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));

	const pending: PendingPayslip[] = [];

	for (const bundle of gathered.bundles) {
		// A skipped joining period is skipped: no payslip, no lines, no statutory charge. The days it
		// covers are not lost — the next run derives them from this employment's own contract, which
		// is why nothing has to be handed over here for that to work.
		if (bundle.deferral != null) continue;

		// 4 — MEASURE
		//
		// On the employment's own cadence: a semi-monthly employment's period is two instalments,
		// 1st–15th and 16th–end, and `salary` is the envelope of them — the same calendar month a
		// monthly employment is measured over, because this run pays both instalments together.
		const cadence = resolveWindow(
			period,
			configuration.company,
			employmentPayFrequency(bundle.terms, window.salary.end)
		);
		const measured = measureEmployment({
			bundle,
			configuration,
			period,
			salary: cadence.salary,
			periodsRemaining: prepared.periodsRemaining,
			headcount: gathered.headcount,
			policy,
			consumedInstalments: gathered.consumedInstalments
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

		// 5 — ACCUMULATE
		const bases = accumulateBases({
			configuration,
			lines: measured.lines,
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
			periodsRemaining: prepared.periodsRemaining,
			// The relief and the married scale turn on whether the spouse has income, not on
			// `marital_status` — see employees.spouse_status.
			spouseIsDependent: bundle.employee.spouse_status === 'WITHOUT_INCOME',
			dependents: Number(bundle.employee.dependents_count ?? 0)
		});

		// 7 — SETTLE
		//
		// A deduction the guard could not take is not carried anywhere. The line records what was
		// actually taken, and the difference between that and the obligation is what remains owed —
		// derived by the next run from these very lines, never copied into it.
		const settlement = settle({ lines: measured.lines, charges });

		pending.push({
			employmentId: bundle.employment.id,
			currency: measured.currency,
			settlement,
			charges,
			// Derived here, where the bundle is in scope, because the claim is a statement about
			// what this run *read* — and the graph only ever sees what it produced.
			claims: claimsForBundle(bundle)
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
	return {
		payslip_payroll_run: graph,
		payslipCount: pending.length,
		lineCount: graph.reduce((total, payslip) => total + payslip.payslip_line_payslip.length, 0),
		claimCount: graph.reduce((total, payslip) => total + payslip.payslip_source_payslip.length, 0),
		warnings: issues
			.filter((issue) => issue.severity === 'WARNING')
			.map((issue) => describeIssues([issue], 'warn'))
	};
}
