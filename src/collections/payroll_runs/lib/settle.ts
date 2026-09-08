/**
 * Step 7 — SETTLE.
 *
 * Four numbers, derived entirely from family pay-item policies and the statutory charges. Nothing
 * here reads a component code.
 *
 * ```
 * gross            = Σ EARNING − Σ ABSENCE
 * statutory (ee)   = Σ payslips.statutory[].employee_amount
 * other deductions = Σ DEDUCTION
 * payments         = Σ NON_WAGE_PAYMENT settled through payroll
 *
 * net              = gross − statutory − other + payments
 * employer cost    = Σ employer_amount + Σ EMPLOYER_COST + Σ company-direct entries
 * ```
 *
 * The sums run over **both planes at once** — the contracted amounts inlined on the payslip and the
 * adjustments each input caused — because gross is a fact about the payslip and not about which
 * table a figure ended up in. Which plane an amount belongs to is decided by what caused it, in
 * MEASURE; nothing here re-decides it, and nothing here reshapes one plane into the other.
 *
 * `total_deductions` includes the employee's statutory contributions and excludes reimbursements.
 * A payroll-settled reimbursement repays the employee's own outlay, so it is added to net without
 * ever having been part of gross. A company-direct entry (for example, a panel-clinic invoice)
 * is instead an employer cost: the row remains on the payslip for provenance, but no cash passes
 * through the employee.
 *
 * Loan repayments may be reduced to protect net pay. Their outstanding amount is derived from
 * paid captures, so partial recovery remains collectible in a later regular period. Single-use
 * entries and statutory charges must settle in full. If those alone make net negative, refuse
 * the payroll before any input is captured.

 */

import { refuse } from '@norbital-ai/bolt/authoring';
import type { ContributionCharge } from './contribute.js';
import type { MeasuredAdjustment, MeasuredBase, PricedItem } from '../../../lib/payroll/family.js';
import { cents } from './rounding.js';
import { decodeNumber } from '@norbital-ai/std/json';

export type Settlement = {
	readonly gross: number;
	readonly totalDeductions: number;
	readonly net: number;
	readonly employerCost: number;
	/** Both planes after the guard has run; identical to the input when net never went negative. */
	readonly base: readonly MeasuredBase[];
	readonly adjustments: readonly MeasuredAdjustment[];
	/** What could not be deducted this period, per component. Empty in the ordinary case. */
	readonly shortfalls: readonly {
		readonly componentCatalogueId: string;
		readonly amount: number;
	}[];
};

/**
 * A company-direct entry costs the employer and never reaches the employee's net.
 *
 * `nature`, not `catalogueComponent.nature`: derived overtime has no component to read it from, and
 * it is an EARNING like any other.
 */
function isCompanyDirect(item: PricedItem): boolean {
	return item.catalogueComponent.settlement === 'COMPANY_DIRECT';
}

export function settle(options: {
	readonly base: readonly MeasuredBase[];
	readonly adjustments: readonly MeasuredAdjustment[];
	readonly charges: readonly ContributionCharge[];
}): Settlement {
	const statutoryEmployee = options.charges.reduce((total, charge) => total + charge.employee, 0);
	const statutoryEmployer = options.charges.reduce((total, charge) => total + charge.employer, 0);

	const sumOf = (items: readonly PricedItem[], nature: string): number =>
		items.reduce((total, item) => total + (item.nature === nature ? item.amount : 0), 0);
	const gross = cents(
		sumOf(options.base, 'EARNING') +
			sumOf(options.adjustments, 'EARNING') -
			sumOf(options.base, 'ABSENCE') -
			sumOf(options.adjustments, 'ABSENCE')
	);
	const paymentsOf = (items: readonly PricedItem[]): number =>
		items.reduce(
			(total, item) =>
				total + (item.nature === 'NON_WAGE_PAYMENT' && !isCompanyDirect(item) ? item.amount : 0),
			0
		);
	const employerOf = (items: readonly PricedItem[]): number =>
		items.reduce(
			(total, item) =>
				total + (item.nature === 'EMPLOYER_COST' || isCompanyDirect(item) ? item.amount : 0),
			0
		);
	const payments = paymentsOf(options.base) + paymentsOf(options.adjustments);
	const employerAmounts = employerOf(options.base) + employerOf(options.adjustments);

	const base = options.base;
	let adjustments = options.adjustments;
	let otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
	let net = cents(gross - statutoryEmployee - otherDeductions + payments);
	const shortfalls: { componentCatalogueId: string; amount: number }[] = [];

	if (net < 0) {
		const reducible = adjustments
			.flatMap((item, index) =>
				item.input.family === 'LOAN_REPAYMENT' && item.nature === 'DEDUCTION' && item.amount > 0
					? [{ index, amount: item.amount, component: item.catalogueComponent }]
					: []
			)
			.toSorted(
				(left, right) =>
					decodeNumber(right.component.sequence) - decodeNumber(left.component.sequence)
			);
		const reducedAdjustments = [...adjustments];
		let outstanding = -net;
		for (const entry of reducible) {
			if (outstanding <= 0) break;
			const relief = Math.min(entry.amount, outstanding);
			if (relief <= 0) continue;
			const amount = cents(entry.amount - relief);
			reducedAdjustments[entry.index] = { ...reducedAdjustments[entry.index]!, amount };
			shortfalls.push({ componentCatalogueId: entry.component.id, amount: cents(relief) });
			outstanding = cents(outstanding - relief);
		}
		adjustments = reducedAdjustments;
		otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
		net = cents(gross - statutoryEmployee - otherDeductions + payments);
	}

	if (net < 0)
		refuse(
			'Payroll net pay is negative. Resolve the approved recovery before calculating this period.'
		);

	return {
		gross,
		totalDeductions: cents(statutoryEmployee + otherDeductions),
		net,
		employerCost: cents(statutoryEmployer + employerAmounts),
		base,
		adjustments,
		shortfalls
	};
}
