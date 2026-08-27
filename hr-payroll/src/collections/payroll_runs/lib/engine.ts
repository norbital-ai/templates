/**
 * The payroll run — eight steps, the same eight for every country.
 *
 * | # | step       | does                                                                          |
 * | - | ---------- | ----------------------------------------------------------------------------- |
 * | 1 | PICK       | resolve the governing configuration as of the period end → `configuration_hash` |
 * | 2 | VALIDATE   | everything that can be wrong before a person is read. Blocked on failure       |
 * | 3 | GATHER     | per employment: entries, leave, time, terms, statutory standing, year-to-date  |
 * | 4 | MEASURE    | in component-type sequence, produce amounts → `payslip_lines`                  |
 * | 5 | ACCUMULATE | each line through the grid → contribution bases                                |
 * | 6 | CONTRIBUTE | each scheme in sequence: base → employee and employer amounts                   |
 * | 7 | SETTLE     | gross, total deductions, net, employer cost                                    |
 * | 8 | PERSIST    | payslip, lines, charges, and the settlement locks over what they consumed      |
 *
 * Step 5 never names EPF. Step 6 never names overtime. Neither knows Malaysia.
 *
 * Re-entry is idempotent by construction: a rebuild deletes the run's results first, so building
 * twice produces the same four collections rather than two overlapping halves.
 */

import { Clock, Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { accumulateBases } from './accumulate.js';
import { claimsForBundle } from './claims.js';
import { withReadLog, type PayrollApi, type PayrollReadApi, type ReadLog } from './api.js';
import { pickConfiguration, type Configuration } from './configuration.js';
import { contribute, type StatutoryFactStatus } from './contribute.js';
import { coversDate } from './effective.js';
import { gatherRun } from './gather.js';
import { dailyTotalWorkLimit, measureEmployment } from './measure.js';
import {
	PAY_FREQUENCIES,
	payPeriodsRemaining,
	resolveWindow,
	type PayFrequency,
	type PayrollWindow
} from './period.js';
import {
	clearRunResults,
	persistDeferrals,
	persistPayslips,
	persistShortfalls,
	type PendingDeferral,
	type PendingPayslip
} from './persist.js';
import { settle } from './settle.js';
import { shiftPeriod } from './dates.js';
import { readSettlementPolicy } from './settlement.js';
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
 * A run either produced payslips or it produced an error.
 *
 * There is no third outcome and therefore no list of issues to hand back: any issue at all stops
 * the build and is thrown, so a result that exists is a result nothing was wrong with. The previous
 * shape carried the warnings out to a caller that dropped them, which meant an unmapped rest-day
 * rule or a breached hours-of-work limit reached nobody.
 */
type PayrollRunResult = {
	readonly window: PayrollWindow;
	readonly configuration: Configuration;
	readonly payslipCount: number;
	readonly lineCount: number;
};

/** What `buildPayrollRun` needs: the run itself and the API it performs it on. */
type BuildPayrollRunOptions = {
	readonly api: PayrollApi;
	readonly runId: string;
	readonly companyId: string;
	readonly period: string;
};

/** Resolve the window and the governing configuration without building anything. */
export function preparePayrollRun(options: {
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
 * Build one company's payroll for one period.
 *
 * The run record must already exist — it carries the configuration hash and the window the build
 * was picked against, so that a payslip can always be traced to the law it was computed under.
 */
export function buildPayrollRun(
	options: BuildPayrollRunOptions
): Effect.Effect<PayrollRunResult, never, never> {
	return Effect.gen(function* () {
		/**
		 * Phase timing. The engine runs inside the tenant runtime container, so every database call is
		 * an RPC hop before it is a query — which makes "how long did each phase take" the only honest
		 * way to tell a slow query from a chatty one from slow arithmetic.
		 */
		const reads = withReadLog(options.api);
		const t0 = yield* Clock.currentTimeMillis;
		let mark = t0;
		const phases: [string, number][] = [];
		/**
		 * Each phase reported as it closes, not only in the summary at the end.
		 *
		 * The summary is the useful shape when a run completes, and it is useless in the one case
		 * profiling is actually needed: a run that exceeds the invocation deadline is killed mid-phase,
		 * so the line naming every phase is never reached and the only evidence left is a 504. Printing
		 * as each phase lands means a killed run still says which phase it died in and how long
		 * everything before it took, which is the difference between a measurement and a guess.
		 */
		const lap = (name: string): Effect.Effect<void> =>
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				phases.push([name, now - mark]);
				yield* Effect.log(
					`[payroll-phase] ${options.period} ${name}=${now - mark}ms elapsed=${now - t0}ms | ${reads.reads.logString()}`
				);
				mark = now;
			});

		// 1 — PICK
		const { window, configuration } = yield* preparePayrollRun(options);
		yield* lap('pick');

		// 2 — VALIDATE
		const issues: RunIssue[] = validateConfiguration(configuration);
		if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));
		yield* lap('validate');

		// 3 — GATHER
		const policy = readSettlementPolicy(configuration.company);
		const gathered = yield* gatherRun({ api: reads, configuration, window, policy });

		yield* lap('gather');

		/**
		 * The projection count is a count of **payslips**, not of pay events.
		 *
		 * One run settles the whole period — every instalment of it — in one payslip carrying a
		 * month's wages, on every cadence. A semi-monthly employment is paid twice a month in the
		 * real world and twenty-four times before a January tax year is out, but it receives the
		 * same twelve payslips this figure is multiplied against, so this is the same number for
		 * both cadences and deliberately so. `payPeriodsRemaining` states why at length.
		 */
		const periodsRemaining = payPeriodsRemaining(
			options.period,
			Number(configuration.jurisdiction.tax_year_start_month)
		);

		// A cadence the company has written no calendar for stops the run here, before a single
		// employment is measured, so the operator reads the issue that names them rather than an
		// exception thrown out of `resolveWindow` five phases in.
		issues.push(...validatePayCalendar({ configuration, bundles: gathered.bundles }));
		// An open clock is caught here rather than three phases in, where `normalizedWorkedIntervals`
		// refuses it as an "invalid interval" — true, but a long way from the record at fault. Reported
		// as issues rather than thrown one at a time, so a month with thirty-six unclosed entries
		// yields one list instead of thirty-six consecutive builds. See `validateOpenTimeEntries`.
		issues.push(...validateOpenTimeEntries({ bundles: gathered.bundles }));
		if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));

		const pending: PendingPayslip[] = [];
		const deferrals: PendingDeferral[] = [];
		const shortfalls: { employmentId: string; payComponentId: string; amount: number }[] = [];

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
				options.period,
				configuration.company,
				employmentPayFrequency(bundle.terms, window.salary.end)
			);
			const measured = measureEmployment({
				bundle,
				configuration,
				period: options.period,
				salary: cadence.salary,
				periodsRemaining,
				headcount: gathered.headcount,
				policy
			});
			if (measured.arrears != null)
				deferrals.push({
					employmentId: bundle.employment.id,
					employeeNumber: bundle.employment.employee_number,
					hireDate: bundle.employment.hire_date,
					coversPeriod: measured.arrears.period,
					paidInPeriod: options.period,
					payComponentId: measured.arrears.payComponentId,
					amount: measured.arrears.amount
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
				periodsRemaining,
				// The relief and the married scale turn on whether the spouse has income, not on
				// `marital_status` — see employees.spouse_status.
				spouseIsDependent: bundle.employee.spouse_status === 'WITHOUT_INCOME',
				dependents: Number(bundle.employee.dependents_count ?? 0)
			});

			// 7 — SETTLE
			const settlement = settle({ lines: measured.lines, charges });
			for (const shortfall of settlement.shortfalls)
				shortfalls.push({ employmentId: bundle.employment.id, ...shortfall });

			pending.push({
				employmentId: bundle.employment.id,
				currency: measured.currency,
				settlement,
				charges,
				// Derived here, where the bundle is in scope, because the claim is a statement about
				// what this run *read* — and PERSIST only ever sees what it wrote.
				claims: claimsForBundle(bundle)
			});
		}

		// Nothing is persisted until every employment has been measured, so a run that breaches an
		// hours-of-work limit for one person on one day writes no payslip for anybody. That is the point:
		// a payroll is published whole or not at all, and the operator is told which person and which day.
		const blocking = blockers(issues);
		if (blocking.length > 0) refuse(describeIssues(blocking));
		const warnings = issues.filter((issue) => issue.severity === 'WARNING');
		if (warnings.length > 0)
			yield* Effect.logWarning(
				`[payroll-warnings] ${options.period} ${describeIssues(warnings, 'warn')}`
			);
		yield* lap('calculate');

		// 8 — PERSIST
		yield* clearRunResults(reads, options.runId);
		yield* lap('clear');
		const written = yield* persistPayslips({
			api: reads,
			runId: options.runId,
			period: options.period,
			pending
		});
		yield* lap('persist');
		yield* persistShortfalls({
			api: reads,
			period: options.period,
			nextPeriod: shiftPeriod(options.period, 1),
			payDate: window.payDate,
			shortfalls
		});
		yield* lap('shortfalls');
		yield* persistDeferrals({ api: reads, deferrals });
		yield* lap('deferrals');

		const totalMs = (yield* Clock.currentTimeMillis) - t0;
		yield* Effect.log(
			`[payroll-timing] ${options.period} total=${totalMs}ms ` +
				phases.map(([name, ms]) => `${name}=${ms}ms`).join(' ') +
				` | employments=${gathered.bundles.length} payslips=${written.payslipCount} lines=${written.lineCount} settled=${written.claimCount}` +
				`\n[payroll-reads] ${reads.reads.logString()}`
		);

		return {
			window,
			configuration,
			payslipCount: written.payslipCount,
			lineCount: written.lineCount
		};
	});
}
