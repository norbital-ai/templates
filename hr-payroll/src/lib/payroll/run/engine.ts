import * as Predicate from 'effect/Predicate';
import { calculateFamilyAssessments } from '../../../lib/payroll/families.js';
/**
 * The payroll run: the same eight steps for every country, split at what reads and what decides.
 *
 * ```
 *  gather  ─┬─ 1 PICK       the governing configuration → configuration_hash
 *           └─ 3 GATHER     employments, terms, facts, entries, repayments, leave, work days, and
 *                           what earlier runs consumed — filtered from the world (`world.ts`)
 *  build   ─┬─ 2 VALIDATE   everything that can be wrong before a person is measured
 *   pure    ├─ 4 MEASURE    base, proration and adjustments, family by family
 *           ├─ 5 ACCUMULATE every amount through the grid → contribution bases
 *           ├─ 6 CONTRIBUTE each scheme in dependency order
 *           ├─ 7 SETTLE     gross, deductions, net, employer cost
 *           └─ 8 GRAPH      the payslips and their captures, returned rather than written
 * ```
 *
 * The run and its result are one write: the transform returns the payload, and the pins on every
 * consumed source are `link` actions in the same transaction, so re-entry is idempotent.
 */

import { refuse } from '../../../lib/refuse.js';
import { recordedFact } from '../../../lib/declared-facts.js';
import type { PayrollWorld } from '../world.js';
import { live } from './effective.js';
import { daysBetween, periodHalf } from './dates.js';
import { coversDate } from './effective.js';
import { employmentDates } from './settlement.js';
import { personContext } from './eligibility.js';
import {
	atWorksite,
	pickConfiguration,
	withDatedPeople,
	withDeclaredFacts,
	type Configuration
} from './configuration.js';
import { gatherRun, type GatheredRun } from './gather.js';
import {
	periodGrammarFault,
	resolveWindow,
	weeklyInstalments,
	type PayrollWindow,
	type RunKind
} from './period.js';
import { calendarDueDate, payCalendarOf } from '../../datatypes/pay_calendar.js';
import { payrollRunGraph, type PendingPayslip } from './graph.js';
import { cents, roundMoney } from './rounding.js';
import {
	isFinalPayslip,
	loanCaptures,
	loanShortfallIssues,
	settleWithOrders
} from '../../../lib/payroll/loan.js';
import {
	finalPayIssues,
	measuredPeriod,
	minimumWageIssues,
	raiseToMinimumWage,
	windowMinimumWage
} from '../../../lib/payroll/contribution.js';
import {
	blockers,
	describeIssues,
	validateChecks,
	validateConfiguration,
	validatePayCalendar,
	type RunIssue
} from './validate.js';
import { checksOf } from '../../datatypes/checks.js';
import { stint } from '../../employment-contract.js';
import type { MeasuredEmployment } from '../family.js';

/**
 * The engine/build identity stamped on every run this code produces.
 *
 * A configuration hash identifies data, not code: without a durable identity for the code that
 * interpreted it, the same captured configuration could be interpreted differently after an engine
 * change and leave nothing on the run to explain the difference. Bump this when the payroll
 * algorithm changes in a way a settled payslip's reader would need to know.
 */
export const CALCULATION_VERSION = '2026-09-run-kinds' as const;

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
	/** The employer-month payable after a scheme's separately versioned aggregate rounding. */
	readonly company_remittances: readonly {
		readonly scheme_code: string;
		readonly month: string;
		readonly currency: string;
		readonly remittance_rounding: 'NONE' | 'FLOOR_MAJOR_UNIT';
		readonly accrued_amount: number;
		readonly payable_amount: number;
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
 * Everything one run reads, read once, before anything is calculated: a run that read while it
 * calculated would have figures that depend on when each query landed.
 */
export type PreparedRun = {
	readonly period: string;
	readonly kind: RunKind;
	readonly window: PayrollWindow;
	readonly configuration: Configuration;
	readonly gathered: GatheredRun;
	/** `scheme:rounding` → what earlier runs of the month already reported to remit. */
	readonly remitted: ReadonlyMap<string, { readonly accrued: number; readonly payable: number }>;
};

type Bundle = GatheredRun['bundles'][number];

/** Whether the employment's exit falls inside its salary window: a FINAL run settles it. */
const exitsInWindow = (bundle: Bundle): boolean => {
	const exit = employmentDates(bundle.employment).exit;
	return exit != null && exit >= bundle.window.salary.start && exit <= bundle.window.salary.end;
};

/** Whether a REGULAR run would settle wages for this bundle: a salary window, a deferral or arrears. */
const settlesSalary = (bundle: Bundle): boolean =>
	bundle.employedDays != null || bundle.deferral != null || bundle.arrearsFor != null;

/**
 * Who a run of `kind` pays, from everyone the gather measured.
 *
 * - REGULAR: everyone, less those a FINAL or EARLY run of the period has already settled.
 * - FINAL: the employments whose exit falls in their window, not yet settled in the period.
 * - EARLY: the people an off-cycle run's selected requests pay whose salary for the period no run has
 *   settled — their REGULAR payslip as recorded so far, without the selected requests, which the
 *   off-cycle run pays beside it.
 * - OFF_CYCLE and CORRECTION: only the selected outstanding requests (a CORRECTION's are ad hoc
 *   lines), paid now whatever their pay period, with no wages, attendance, leave or recovery beside
 *   them — which is what lets them pay someone who has already left. An OFF_CYCLE run refuses a person
 *   whose salary is not settled yet: the transform settles it first (EARLY), so every statutory charge
 *   is priced on the month's real pay.
 *
 * Headcount stays the gather's: who the company employs does not change with who a run pays.
 */
function population(options: {
	readonly kind: RunKind;
	readonly sources: readonly string[];
	readonly period: string;
	readonly bundles: readonly Bundle[];
	readonly settledHere: ReadonlySet<string>;
}): Bundle[] {
	const { kind, bundles, settledHere } = options;
	if (kind === 'REGULAR') return bundles.filter((b) => !settledHere.has(b.employment.id));
	if (kind === 'FINAL') {
		const leaving = bundles.filter(
			(bundle) => !settledHere.has(bundle.employment.id) && exitsInWindow(bundle)
		);
		if (leaving.length === 0)
			refuse(`No employment exits in ${options.period} that a run has not already settled.`);
		return leaving;
	}
	const selected = new Set(options.sources);
	const outstanding = new Map(
		bundles.flatMap((bundle) =>
			bundle.payRequests
				.filter((request) => request.approval_id == null && !request.captured)
				.map((request) => [request.id, { ...request, bundle }] as const)
		)
	);
	const unsettled = (bundle: Bundle) =>
		settlesSalary(bundle) &&
		!settledHere.has(bundle.employment.id) &&
		bundle.payRequests.some((request) => selected.has(request.id) && outstanding.has(request.id));
	// A leaver's salary is settled by their FINAL run, which also pays what only a leaver is owed.
	if (kind === 'EARLY')
		return bundles.filter((bundle) => unsettled(bundle) && !exitsInWindow(bundle)).map((bundle) => ({
			...bundle,
			payRequests: bundle.payRequests.filter((request) => !selected.has(request.id))
		}));
	if (selected.size === 0) refuse(`A ${kind} run pays only the requests it selects; select one.`);
	for (const id of selected) {
		const request = outstanding.get(id);
		if (request == null)
			refuse(`Request ${id} is not an outstanding, approved claim or ad hoc request here.`);
		if (kind === 'CORRECTION' && request.family !== 'ADHOC')
			refuse(`A correction pays ad hoc lines only; request ${id} is a ${request.family}.`);
		// A leaver's separation payment is final pay: it settles with the leaver's last salary.
		const exit = employmentDates(request.bundle.employment).exit;
		if (
			kind === 'OFF_CYCLE' &&
			'raised_by' in request.catalogueComponent &&
			request.catalogueComponent.raised_by === 'SEPARATION' &&
			exit != null &&
			exit <= request.bundle.window.salary.end
		)
			refuse(
				`${request.bundle.employment.employee_number}: ${request.catalogueComponent.code} is a leaver's ` +
					'separation payment. Pay it in their FINAL run, or in a regular run once that has settled.'
			);
	}
	if (kind === 'OFF_CYCLE')
		for (const bundle of bundles.filter(unsettled))
			refuse(
				exitsInWindow(bundle)
					? `${bundle.employment.employee_number} leaves in ${options.period}: run their FINAL run first, then ` +
							'the off-cycle run, so the off-cycle payment is priced on their final month.'
					: `${bundle.employment.employee_number}: ${options.period} salary is not settled yet. Settle it first ` +
							'(an EARLY run), so the off-cycle payment is priced on the real month.'
			);
	return bundles.flatMap((bundle) => {
		const payRequests = bundle.payRequests
			.filter((request) => selected.has(request.id))
			.map((request) => ({ ...request, pay_period: options.period }));
		if (payRequests.length === 0) return [];
		return [
			{
				...bundle,
				payRequests,
				employedDays: null,
				wageDays: null,
				arrearsFor: null,
				deferral: null,
				workDays: [],
				loanRepayments: [],
				leave: { ...bundle.leave, entries: [] }
			}
		];
	});
}

export function gatherPayrollRun(options: {
	readonly world: PayrollWorld;
	readonly companyId: string;
	readonly period: string;
	readonly payDueDate?: string | undefined;
	readonly kind?: RunKind | undefined;
	readonly sources?: readonly string[] | undefined;
}): PreparedRun {
	const { world, companyId, period } = options;
	const kind = options.kind ?? 'REGULAR';
	const company = live(world.companies).find((row) => row.id === companyId);
	if (!company) refuse(`Company ${companyId} does not exist.`);
	// The wrong grammar (months at a monthly company, halves at a semi-monthly one) is refused
	// here, naming the company's frequency, before a window is resolved.
	const fault = periodGrammarFault(period, company);
	if (fault != null) refuse(fault);
	// A weekly month is settled week by week, so no single run settles a person's month early: the
	// off-cycle payment waits until the month's pay is whole (owner default).
	if ((kind === 'OFF_CYCLE' || kind === 'EARLY') && company.pay_frequency === 'WEEKLY') {
		const last = `${period.slice(0, 7)}-${weeklyInstalments(period).length}`;
		if (
			!world.payroll_runs.some(
				(run) =>
					run.company_id === companyId &&
					run.period === last &&
					(run.kind ?? 'REGULAR') === 'REGULAR'
			)
		)
			refuse(
				`${company.name} pays weekly, so an off-cycle run waits for the month's last weekly run (${last}): ` +
					'its statutory charges are priced on the whole month already paid.'
			);
	}
	let window = resolveWindow(period, company, options.payDueDate);
	let configuration = pickConfiguration({ world, companyId, window });
	// No stated due date: the version's pay calendar dates the wages, and the law is picked again
	// on the dated window, since a rule may select on when wages become payable.
	const payDueDate =
		options.payDueDate ??
		calendarDueDate({
			calendar: payCalendarOf(configuration.jurisdiction.payroll),
			cadence: window.payFrequency,
			period: window.salary,
			run: { period, pay_date: window.payDate },
			company: { settings_code: company.settings_code, pay_frequency: company.pay_frequency }
		});
	if (payDueDate !== options.payDueDate) {
		window = resolveWindow(period, company, payDueDate);
		configuration = pickConfiguration({ world, companyId, window });
	}
	const gathered = gatherRun({
		world: withDatedPeople(configuration, withDeclaredFacts(configuration, world, window)),
		configuration,
		window,
		payDueDate
	});
	const month = period.slice(0, 7);
	const runsHere = world.payroll_runs.filter(
		(run) => run.company_id === companyId && run.period.slice(0, 7) === month
	);
	// The runs that settle a person's period whole: a REGULAR, FINAL or EARLY slip is not paid twice.
	const settling = new Set(
		runsHere
			.filter(
				(run) =>
					run.period === period && ['REGULAR', 'FINAL', 'EARLY'].includes(run.kind ?? 'REGULAR')
			)
			.map((run) => run.id)
	);
	const remitted = new Map<string, { accrued: number; payable: number }>();
	for (const run of runsHere)
		for (const row of run.company_remittances ?? []) {
			if (row.month !== month) continue;
			const key = `${row.scheme_code}:${row.remittance_rounding}`;
			const sum = remitted.get(key) ?? { accrued: 0, payable: 0 };
			remitted.set(key, {
				accrued: sum.accrued + row.accrued_amount,
				payable: sum.payable + row.payable_amount
			});
		}
	return {
		period,
		kind,
		window,
		configuration,
		remitted,
		gathered: {
			...gathered,
			bundles: population({
				kind,
				sources: options.sources ?? [],
				period,
				bundles: gathered.bundles,
				settledHere: new Set(
					world.payslips
						.filter((slip) => settling.has(slip.payroll_run_id))
						.map((slip) => slip.employment_id)
				)
			})
		}
	};
}

type CoverageSpan = 'SALARY' | 'ATTENDANCE' | 'ARREARS' | 'SERVICE_AFTER_EXIT';

/**
 * The version's territorial reach (`payroll.worksite_coverage`). Each day of the declared spans
 * must place the person, by the terms row in force that day, at a value the version covers; a
 * listed `refused` value names the profile that governs it instead. A lineage that declares none has no
 * territorial guard; a rule over the person (a territory another profile governs) is a stored PAYSLIP check.
 */
function assertWorksiteCoverage(configuration: Configuration, gathered: GatheredRun): void {
	const coverage = configuration.jurisdiction.payroll.worksite_coverage;
	if (coverage == null) return;
	const covered = new Set(
		coverage.covered_by_wage_regions === true
			? Object.keys(configuration.jurisdiction.work_rules.wages?.by_region ?? {})
			: (coverage.covered ?? [])
	);
	const factKey = coverage.source.startsWith('facts.') ? coverage.source.slice(6) : null;
	const valueOn = (terms: GatheredRun['bundles'][number]['termsHistory'], day: string) => {
		const row = terms.find((term) => coversDate(term.effective_range, day));
		const value = factKey == null ? row?.worksite : recordedFact(row, factKey);
		return Predicate.isString(value) ? value.trim() : '';
	};
	const fill = (message: string, value: string, day: string) =>
		message.replaceAll('{value}', value).replaceAll('{day}', day);
	const spans = new Set<CoverageSpan>(coverage.spans);
	for (const bundle of gathered.bundles) {
		const who = bundle.employment.employee_number;
		const { hire, exit } = employmentDates(bundle.employment);
		// A day an overlay routes is covered by the overlay lineage, not refused (E8).
		const seen = atWorksite(configuration, bundle.termsHistory, bundle.workDays, bundle.employee);
		const routed = (day: string) =>
			seen.onDay != null && seen.onDay(day).jurisdiction !== configuration.jurisdiction;
		const employed = (span: { readonly start: string; readonly end: string } | null | undefined) =>
			span == null
				? []
				: daysBetween(span.start, span.end).filter(
						(day) => day >= hire && (exit == null || day <= exit)
					);
		const checked: [CoverageSpan, readonly string[]][] = [
			['SALARY', employed(bundle.employedDays)],
			['ATTENDANCE', employed(bundle.attendance)],
			['ARREARS', employed(bundle.arrearsFor?.days)],
			[
				'SERVICE_AFTER_EXIT',
				exit != null && exit < bundle.window.salary.start ? daysBetween(hire, exit) : []
			]
		];
		for (const [span, days] of checked) {
			if (!spans.has(span)) continue;
			for (const day of days) {
				if (routed(day)) continue;
				const value = valueOn(bundle.termsHistory, day);
				const elsewhere = coverage.refused?.find((row) => row.values.includes(value));
				if (elsewhere != null) refuse(`${who}: ${fill(elsewhere.message, value, day)}`);
				if (covered.has(value)) continue;
				const where = value === '' ? 'an unrecorded worksite' : `worksite "${value}"`;
				refuse(
					`${who}: ` +
						(coverage.uncovered_message != null
							? fill(coverage.uncovered_message, value, day)
							: span === 'SERVICE_AFTER_EXIT'
								? `${configuration.jurisdiction.code} cannot price a post-exit payment with ${where} on ${day}; ` +
									'record the dated contract performance place on employment terms under the version that covers it.'
								: `${configuration.jurisdiction.code} cannot price ${day} at ${where}. Record the dated ` +
									'contract performance place on employment terms under the version that covers it.')
				);
			}
		}
	}
}

/**
 * The version's stored checks at the run's own stages (E9) over one settled payslip: PAYSLIP once, on
 * the salary window's end (a leaver's last day), and DEDUCTION once per deduction line. Read on the
 * employment's own configuration, so a day an overlay governs reads the overlay's checks.
 */
function runChecks(options: {
	readonly configuration: Configuration;
	readonly gathered: GatheredRun;
	readonly measured: MeasuredEmployment;
	readonly settlement: ReturnType<typeof settleWithOrders>['settlement'];
	readonly payDate: string;
}): RunIssue[] {
	const { bundle } = options.measured;
	const configuration = atWorksite(
		options.configuration,
		bundle.termsHistory,
		bundle.workDays,
		bundle.employee
	);
	const { exit } = employmentDates(bundle.employment);
	const salaryEnd = bundle.window.salary.end;
	const date = exit != null && exit < salaryEnd ? exit : salaryEnd;
	const stages = checksOf((configuration.onDay?.(date) ?? configuration).jurisdiction);
	if (!stages.some((check) => check.at === 'PAYSLIP' || check.at === 'DEDUCTION')) return [];
	const person = personContext({
		employee: bundle.employee,
		employment: stint(bundle.employment, configuration.jurisdiction.exit_facts ?? []),
		terms: bundle.termsHistory.find((row) => coversDate(row.effective_range, date)) ?? null,
		children: bundle.children,
		presence: bundle.presence,
		// The slip's own measured week and period, as its contribution stage reads them.
		week: options.measured.week,
		period: measuredPeriod(options.measured),
		company: {
			...configuration.company,
			headcount: options.gathered.headcount,
			headcount_citizens: options.gathered.headcountCitizens
		},
		asOf: date
	});
	const { settlement } = options;
	const lines: Record<string, number> = {};
	for (const line of [...settlement.base, ...settlement.adjustments])
		lines[line.catalogueComponent.code] = (lines[line.catalogueComponent.code] ?? 0) + line.amount;
	const subject = {
		employeeNumber: bundle.employment.employee_number,
		employmentId: bundle.employment.id,
		person
	};
	const deductions = settlement.adjustments.filter((line) => line.bucket === 'DEDUCTION');
	return [
		...validateChecks({
			configuration,
			at: 'PAYSLIP',
			date,
			subjects: [
				{
					...subject,
					roots: {
						payslip: {
							gross: settlement.gross,
							net: settlement.net,
							deductions: settlement.totalDeductions,
							lines,
							pay_date: options.payDate
						}
					}
				}
			]
		}),
		...validateChecks({
			configuration,
			at: 'DEDUCTION',
			date,
			subjects: deductions.map((line) => ({
				...subject,
				roots: {
					deduction: {
						code: line.catalogueComponent.code,
						amount: line.amount,
						gross: settlement.gross,
						// Net pay as it stands without this line.
						net: settlement.net + line.amount,
						total: settlement.totalDeductions
					}
				}
			}))
		})
	];
}

/**
 * Turn prepared facts into the run's complete result. Pure: no database, no clock, no writes.
 *
 * Every refusal in here happens before anything is written, because there is nothing to write with.
 */
export function buildPayrollRun(prepared: PreparedRun): PayrollRunGraph {
	const { configuration, window, period } = prepared;

	// 2 — VALIDATE
	const issues: RunIssue[] = validateConfiguration(configuration);
	if (blockers(issues).length > 0) refuse(describeIssues(blockers(issues)));
	assertWorksiteCoverage(configuration, prepared.gathered);
	// A floor that substitutes itself for the agreed wage (TW 最低工資法 §5) re-rates the terms
	// before anything is measured, so pay, proration and every rate derived from it read the floor.
	const raised = raiseToMinimumWage(configuration, prepared.gathered.bundles);
	const gathered: GatheredRun = { ...prepared.gathered, bundles: raised.bundles };
	issues.push(...raised.issues);

	// A cadence the company has written no calendar for stops the run here, before a single
	// employment is measured, so the operator reads the issue that names them rather than an
	// exception thrown out of `resolveWindow` five phases in.
	issues.push(...validatePayCalendar({ configuration, bundles: gathered.bundles }));
	for (const bundle of gathered.bundles)
		for (const terms of bundle.terms)
			if (terms.currency !== configuration.jurisdiction.payroll.currency)
				issues.push({
					code: 'PAY_CURRENCY_UNCONVERTED',
					message:
						`${bundle.employment.employee_number} has ${terms.currency} contract wages, but ` +
						`this payroll assesses ${configuration.jurisdiction.payroll.currency}. Record a sourced ` +
						'conversion before payroll can calculate statutory charges.',
					collection: 'employment_terms',
					recordId: terms.id
				});

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
		...minimumWageIssues({
			configuration,
			bundles: gathered.bundles,
			measured: measuredContracts.map(({ measured }) => measured),
			charges: chargesByEmployment,
			headcountCitizens: gathered.headcountCitizens,
			asOf: window.salary.end
		}),
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
		// An off-cycle payslip pays only what it selected: a deduction there has no earning of the
		// same run to come out of, so its statutory and net would be priced on a negative payment.
		const buckets = measured.adjustments.map((line) => line.bucket);
		if (
			prepared.kind === 'OFF_CYCLE' &&
			buckets.some((bucket) => bucket === 'DEDUCTION' || bucket === 'ABSENCE') &&
			!buckets.some((bucket) => bucket === 'EARNING' || bucket === 'NON_WAGE_PAYMENT')
		)
			refuse(
				`${employment.employee_number}: an off-cycle payslip with only deductions has no earning to take them ` +
					'from. Select an earning for this person in the same run, or leave the deduction to the next regular run.'
			);
		// 7 — SETTLE
		//
		// A recovery the guard dropped is not carried anywhere: its repayment row stays unlinked
		// and the next run recovers it whole.
		// Rule-recovered deduction orders (L6) settle after the rest of the payslip; with none it is `settle`.
		const { settlement, issues: orderIssues } = settleWithOrders({
			base: measured.base,
			adjustments: measured.adjustments,
			charges,
			currency: measured.currency,
			employeeNumber: employment.employee_number,
			ceiling: configuration.jurisdiction.payroll.deduction_ceiling,
			monthPrior: gathered.monthPrior.get(`${employment.employee_id}:${period.slice(0, 7)}`),
			finalPay: isFinalPayslip(measured.bundle),
			bundle: measured.bundle,
			configuration
		});
		issues.push(...orderIssues);
		issues.push(
			...runChecks({ configuration, gathered, measured, settlement, payDate: window.payDate })
		);
		const loans = loanCaptures({
			bundle: measured.bundle,
			settlement,
			captured: measured.captured.loanRepayments
		});
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
				employeeNumber: employment.employee_number,
				employmentId: employment.id,
				loans: measured.bundle.loans,
				settlement
			})
		);

		pending.push({
			employmentId: employment.id,
			employeeNumber: employment.employee_number,
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
			minimumWage:
				measured.bundle.employedDays == null &&
				measured.bundle.arrearsFor == null &&
				measured.bundle.deferral == null
					? 0
					: windowMinimumWage(
							configuration,
							measured.bundle.employedDays ??
								measured.bundle.arrearsFor?.days ??
								measured.bundle.deferral!.days,
							measured.bundle.termsHistory,
							employment.employee_number
						),
			// The captured inputs: every source the run read, whether or not it produced money. The
			// pins are the settlement lock, so zero-value sources ride with the payslip too — except a
			// repayment the guard dropped, which no slip recovered.
			captured: { ...measured.captured, loanRepayments: loans.link },
			orderRepayments: loans.create
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
	const closingInstalment =
		window.payFrequency === 'MONTHLY' ||
		periodHalf(period) ===
			(window.payFrequency === 'WEEKLY' ? weeklyInstalments(period).length : 2);
	const companyRemittances = !closingInstalment
		? []
		: configuration.contributions.flatMap(({ row }) => {
				if (row.remittance_rounding !== 'FLOOR_MAJOR_UNIT') return [];
				const currency = configuration.jurisdiction.payroll.currency;
				// Each part of the month apart: the charges the scheme rounds (SG SDL for local
				// employees, paid with CPF) floored, the rest remitted as they are (SSG SDL NOA 2023 FAQ F.7).
				const unroundedPrior = gathered.companyMonthPrior?.unrounded.get(row.code) ?? 0;
				const prior = {
					FLOOR_MAJOR_UNIT:
						(gathered.companyMonthPrior?.produced.get(row.code)?.employer ?? 0) - unroundedPrior,
					NONE: unroundedPrior
				};
				return (['FLOOR_MAJOR_UNIT', 'NONE'] as const).flatMap((rounding) => {
					const current = graph.reduce(
						(sum, slip) =>
							sum +
							slip.statutory
								.filter(
									(charge) =>
										charge.scheme_code === row.code && charge.remittance_rounding === rounding
								)
								.reduce((charges, charge) => charges + charge.employer_amount, 0),
						0
					);
					const accrued = cents(prior[rounding] + current, currency);
					if (accrued < 0)
						refuse(
							`${row.code}: a negative employer-month balance requires refund reconciliation.`
						);
					// A month closed by more than one run (a FINAL beside the REGULAR) reports each
					// run's increment, so the month's rows sum to one remittance of the whole month.
					const reported = prepared.remitted.get(`${row.code}:${rounding}`) ?? {
						accrued: 0,
						payable: 0
					};
					const payable = rounding === 'NONE' ? accrued : roundMoney(accrued, 'FLOOR_UNIT');
					const increment = cents(accrued - reported.accrued, currency);
					if (increment === 0) return [];
					return [
						{
							scheme_code: row.code,
							month: period.slice(0, 7),
							currency,
							remittance_rounding: rounding,
							accrued_amount: increment,
							payable_amount: cents(payable - reported.payable, currency)
						}
					];
				});
			});
	return {
		payslip_payroll_run: graph,
		company_remittances: companyRemittances,
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

/**
 * The world as it stands once a run built in the same act is written: its run row and payslips are history and
 * every source it captured carries its pin. The off-cycle transform builds its EARLY run first and prices the
 * off-cycle run on this world, so `bill(salary + entry) − bill(salary)` reads the salary slip it sits beside.
 */
export function withBuiltRun(
	world: PayrollWorld,
	prepared: PreparedRun,
	built: PayrollRunGraph,
	sequence: number
): PayrollWorld {
	const runId = crypto.randomUUID();
	// repository-health:allow R3b -- the run as its write stores it; the fields the write itself fills are read by no gather
	const run = {
		id: runId,
		company_id: prepared.configuration.company.id,
		period: prepared.period,
		kind: prepared.kind,
		sequence,
		pay_date: prepared.window.payDate,
		pay_due_date: prepared.window.payDueDate,
		attendance_from: prepared.window.attendance.start,
		attendance_to: prepared.window.attendance.end,
		company_charges: built.company_charges,
		company_remittances: built.company_remittances,
		approval_id: null
	} as unknown as PayrollWorld['payroll_runs'][number];
	const slips = built.payslip_payroll_run.map(
		(slip) =>
			// repository-health:allow R3b -- a built payslip is the row its write stores, less the defaults the write fills
			({ ...slip, payroll_run_id: runId, approval_id: null }) as unknown as PayrollWorld['payslips'][number]
	);
	const pinned = (ids: (capture: (typeof built.captures)[number]) => readonly string[]) =>
		new Map(built.captures.flatMap((capture) => ids(capture).map((id) => [id, capture.payslipId])));
	const pin = <R extends { readonly id: string }>(rows: readonly R[], by: Map<string, string>) =>
		rows.map((row) => (by.has(row.id) ? { ...row, payslip_id: by.get(row.id)! } : row));
	return {
		...world,
		payroll_runs: [...world.payroll_runs, run],
		payslips: [...world.payslips, ...slips],
		work_days: pin(
			world.work_days,
			pinned((capture) => capture.workDays)
		),
		claim_requests: pin(
			world.claim_requests,
			pinned((capture) => capture.claims)
		),
		adhoc_requests: pin(
			world.adhoc_requests,
			pinned((capture) => capture.adhoc)
		),
		leave_entries: pin(
			world.leave_entries,
			pinned((capture) => capture.leave)
		),
		loan_repayments: pin(
			world.loan_repayments,
			pinned((capture) => capture.loanRepayments)
		)
	};
}
