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
import type { PayrollWorld } from '../world.js';
import { live } from './effective.js';
import { periodHalf } from './dates.js';
import { pickConfiguration, type Configuration } from './configuration.js';
import { gatherRun, type GatheredRun } from './gather.js';
import {
	periodGrammarFault,
	resolveWindow,
	weeklyInstalments,
	type PayrollWindow
} from './period.js';
import { payrollRunGraph, type PendingPayslip } from './graph.js';
import { settle } from './settle.js';
import { cents, roundMoney } from './rounding.js';
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
export const CALCULATION_VERSION = '2026-09-payroll-minimum-wage-payment' as const;

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
	readonly window: PayrollWindow;
	readonly configuration: Configuration;
	readonly gathered: GatheredRun;
};

export function gatherPayrollRun(options: {
	readonly world: PayrollWorld;
	readonly companyId: string;
	readonly period: string;
}): PreparedRun {
	const { world, companyId, period } = options;
	const company = live(world.companies).find((row) => row.id === companyId);
	if (!company) refuse(`Company ${companyId} does not exist.`);
	// The wrong grammar (months at a monthly company, halves at a semi-monthly one) is refused
	// here, naming the company's frequency, before a window is resolved.
	const fault = periodGrammarFault(period, company);
	if (fault != null) refuse(fault);
	const window = resolveWindow(period, company);
	const configuration = pickConfiguration({ world, companyId, window });
	return { period, window, configuration, gathered: gatherRun({ world, configuration, window }) };
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
		// 7 — SETTLE
		//
		// A recovery the guard dropped is not carried anywhere: its repayment row stays unlinked
		// and the next run recovers it whole.
		const settlement = settle({
			base: measured.base,
			adjustments: measured.adjustments,
			charges,
			currency: measured.currency,
			employeeNumber: employment.employee_number,
			ceiling: configuration.jurisdiction.payroll.deduction_ceiling,
			monthPrior: gathered.monthPrior.get(`${employment.employee_id}:${period.slice(0, 7)}`),
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
				// employees, paid with CPF) floored, the rest remitted as they are (SWDA SDL FAQ F.7).
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
					if (accrued === 0) return [];
					if (accrued < 0)
						refuse(
							`${row.code}: a negative employer-month balance requires refund reconciliation.`
						);
					return [
						{
							scheme_code: row.code,
							month: period.slice(0, 7),
							currency,
							remittance_rounding: rounding,
							accrued_amount: accrued,
							payable_amount: rounding === 'NONE' ? accrued : roundMoney(accrued, 'FLOOR_UNIT')
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
