import { Effect } from 'effect';
import { decodeNumber } from '@norbital-ai/std/json';
import type { Configuration } from '../../collections/payroll_runs/lib/configuration.js';
import type { EmploymentBundle } from '../../collections/payroll_runs/lib/gather.js';
import type { WorkspaceRow } from '../../collections/payroll_runs/$types.js';
export type Loan = WorkspaceRow<'loans'>;
export type LoanRepayment = WorkspaceRow<'loan_repayments'>;
import { defaultPayPeriod, type PayCadence } from '../../collections/payroll_runs/lib/period.js';
import { dateKey } from '../../collections/payroll_runs/lib/dates.js';
import { cents } from '../../collections/payroll_runs/lib/rounding.js';
import { isEligible, type PersonContext } from '../../collections/payroll_runs/lib/eligibility.js';
import { overRecoversRepayment, repaymentOverRecoveredMessage } from '../settlement_refusals.js';
import {
	PAGE_LIMIT,
	groupBy,
	type PayrollReadApi,
	type ReadLog
} from '../../collections/payroll_runs/lib/api.js';
import { live } from '../../collections/payroll_runs/lib/effective.js';
import type { MeasuredAdjustment } from './family.js';

type MeasureRecoveryOptions = {
	readonly bundle: EmploymentBundle;
	readonly configuration: Configuration;
	readonly period: string;
	readonly cutoffDay: number;
	readonly cadence: PayCadence;
	readonly subject: PersonContext;
	readonly consumedRepayments: ReadonlyMap<string, number>;
};

export function measureLoanRecoveries(options: MeasureRecoveryOptions): MeasuredAdjustment[] {
	const recoveries: MeasuredAdjustment[] = [];
	const componentById = new Map(
		options.configuration.catalogueComponents.map((component) => [component.id, component])
	);
	const loanById = new Map(options.bundle.loans.map((loan) => [loan.id, loan]));
	// In `(due_date, sequence)` order, which is the plan's order and stable for the same rows;
	// nothing about the money depends on it, but a payslip whose row order moved between two
	// identical builds would look like a change.
	const dueRepayments = [...options.bundle.loanRepayments].toSorted(
		(left, right) =>
			String(left.due_date).localeCompare(String(right.due_date)) || left.sequence - right.sequence
	);
	for (const repayment of dueRepayments) {
		const component = componentById.get(loanById.get(repayment.loan_id)?.loan_catalogue_id ?? '');
		if (component == null || component.nature !== 'DEDUCTION') continue;
		if (!isEligible(component.eligibility, options.subject)) continue;
		const due = dateKey(repayment.due_date) ?? String(repayment.due_date).slice(0, 10);
		/**
		 * Due by now, not due exactly now.
		 *
		 * A repayment an earlier run could not take in full is still owed, and this is where it is
		 * recovered — by re-deriving what is outstanding against what was actually recovered, rather
		 * than by a copy of it written into next month's schedule. A repayment already settled in
		 * full nets to zero here and produces nothing.
		 */
		if (defaultPayPeriod(due, options.cutoffDay, options.cadence) > options.period) continue;
		const consumed = options.consumedRepayments.get(repayment.id) ?? 0;
		const outstanding = repaymentOutstanding(repayment, consumed);
		if (outstanding <= 0) continue;
		const amount = cents(outstanding);
		assertWithinRepayment({
			repayment,
			dueDate: due,
			consumed,
			proposed: amount,
			period: options.period
		});
		recoveries.push({
			input: { family: 'LOAN_REPAYMENT', id: repayment.id },
			catalogueComponent: component,
			nature: component.policy?.kind ?? null,
			label: component.code,
			amount,
			quantity: null,
			rate: null,
			statutoryRuleKey: null
		});
	}
	return recoveries;
}

/**
 * The cross-run ceilings, raised where the amount is derived.
 *
 * A repayment may legitimately be touched by several payslips — net-pay protection can part-recover
 * it — so the junction carries no global unique index, and the ceiling that keeps the sum of what
 * every paid run recovered inside the amount due is arithmetic. This is that arithmetic, and
 * `REPAYMENT_OVER_RECOVERED` is its name. The entry ceiling beside it is the defence-in-depth
 * statement of single use: a one-off entry belongs to at most one standing/paid payslip, which the
 * gather step refuses outright, so this check guards the shape rather than the practice.
 */
type RepaymentCeiling = Readonly<{
	readonly repayment: LoanRepayment;
	/** The due date as a calendar day, for the refusal's sentence. */
	readonly dueDate: string;
	readonly consumed: number;
	readonly proposed: number;
	readonly period: string;
}>;

function assertWithinRepayment(options: RepaymentCeiling): void {
	const consumption = {
		loan_repayment_id: options.repayment.id,
		due_date: options.dueDate,
		amount_due: decodeNumber(options.repayment.amount_due),
		consumed: options.consumed,
		proposed: options.proposed,
		period: options.period
	};
	if (overRecoversRepayment(consumption))
		throw new Error(repaymentOverRecoveredMessage(consumption));
}

/** Loan owns its agreements and recovery schedule; no obligation rows are copied into payroll. */
export function prepareLoanPayroll(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly employmentIds: readonly string[];
}) {
	return Effect.gen(function* () {
		const rows = yield* options.api.db.loans.findMany({
			where: { employment_id: { in: [...options.employmentIds] }, approval_id: { isNull: true } },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(rows, 'loans');
		const loans = live(rows);
		const repayments =
			loans.length === 0
				? []
				: yield* options.api.db.loan_repayments.findMany({
						where: { loan_id: { in: loans.map((row) => row.id) } },
						limit: PAGE_LIMIT
					});
		options.api.reads.assertComplete(repayments, 'loan repayments');
		return {
			loansByEmployment: groupBy(loans, (row) => row.employment_id),
			repaymentsByLoan: groupBy(live(repayments), (row) => row.loan_id)
		};
	});
}

/**
 * What is still owed on a repayment, after what earlier PAID runs actually took.
 *
 * There is no carried-forward shortfall anywhere in this engine: a deduction the negative-net guard
 * could not take stays outstanding on the repayment, and the next run re-derives the remainder from
 * this same subtraction.
 */
export function repaymentOutstanding(repayment: LoanRepayment, consumed: number): number {
	const due = decodeNumber(repayment.amount_due);
	const taken = Math.min(Math.max(consumed, 0), due);
	return Math.max(0, due - taken);
}

export function prepareLoanCatalogue(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly settingsId: string;
}) {
	return Effect.gen(function* () {
		const rows = yield* options.api.db.loan_catalogue.findMany({
			where: { settings_id: { eq: options.settingsId }, approval_id: { isNull: true } },
			limit: PAGE_LIMIT
		});
		options.api.reads.assertComplete(rows, 'loan catalogue');
		return live(rows).map((row) => ({
			...row,
			family: 'LOAN' as const,
			settlement: row.definition.settlement
		}));
	});
}
export function prepareLoanConsumption(options: {
	readonly api: PayrollReadApi & { readonly reads: ReadLog };
	readonly payslipIds: readonly string[];
}) {
	return Effect.gen(function* () {
		const db = options.api.db;
		const priorPayslipIds = [...options.payslipIds];
		const consumedRepayments = new Map<string, number>();
		const [links, payslips] = yield* Effect.all(
			[
				db.payslip_loan_repayment_inputs.findMany({
					where: { payslip_id: { in: priorPayslipIds } },
					columns: { loan_repayment_id: true },
					limit: PAGE_LIMIT
				}),
				db.payslips.findMany({
					where: { id: { in: priorPayslipIds } },
					columns: { id: true, adjustments: true },
					limit: PAGE_LIMIT
				})
			],
			{ concurrency: 'unbounded' }
		);
		options.api.reads.assertComplete(links, 'prior loan-repayment captures');
		options.api.reads.assertComplete(payslips, 'prior loan-recovery adjustments');
		// A paid capture with no output consumed zero, rather than leaving historical usage unknown.
		for (const row of links) consumedRepayments.set(row.loan_repayment_id, 0);
		for (const payslip of payslips)
			for (const row of payslip.adjustments) {
				if (row.family !== 'LOAN_REPAYMENT') continue;
				consumedRepayments.set(
					row.source_id,
					(consumedRepayments.get(row.source_id) ?? 0) + decodeNumber(row.amount ?? 0)
				);
			}
		return consumedRepayments;
	});
}
