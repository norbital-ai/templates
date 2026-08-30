/**
 * Step 7 — SETTLE.
 *
 * Four numbers, derived entirely from `pay_components.policy` and the statutory charges. Nothing
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
 * ## The negative-net guard
 *
 * If net would fall below zero, deductions are reduced in **reverse component-type sequence** until
 * net is exactly zero. Nothing is ever reduced below zero and nothing is ever written off.
 *
 * What could not be taken **is not carried anywhere.** It used to be: a fresh `component_entries`
 * row dated next month, written one facility call per employee by a `persistShortfalls` that had to
 * delete last build's copies first so a rebuild could not make somebody owe the same money twice.
 * That was a second representation of a debt its own source already records.
 *
 * The debt now stays where it was born. The row below records what was *actually* taken, so what is
 * still owed is `source amount − Σ(what earlier paid runs took)` — read back from earlier PAID
 * runs by `gather.ts` and re-derived by `measureLoanRecoveries`. `shortfalls` is retained as a
 * statement of what this run reduced and by how much; nothing persists it, and nothing needs to.
 *
 * The plan makes reducibility a `definition.reducible` flag on the pay component. The schema
 * carries that flag only on the `SCHEDULE` arm, so it cannot be read for a deduction; the order is
 * therefore taken from the pay component policy —
 * `OTHER_DEDUCTION` first, `LOAN_REPAYMENT` next, `STATUTORY_ORDER` never, because a court order
 * cannot be shrunk by policy, and statutory contributions never, because they are not a company's
 * to reduce.
 */

import type { ContributionCharge } from './contribute.js';
import type { MeasuredAdjustment, MeasuredBase, PricedItem } from './measure.js';
import { cents } from './rounding.js';

/** Types that a shortfall may never touch, in the order the guard would otherwise reach them. */
const PROTECTED_DEDUCTION_TYPES = new Set(['STATUTORY_ORDER']);

export type Settlement = {
	readonly gross: number;
	readonly totalDeductions: number;
	readonly net: number;
	readonly employerCost: number;
	/** Both planes after the guard has run; identical to the input when net never went negative. */
	readonly base: readonly MeasuredBase[];
	readonly adjustments: readonly MeasuredAdjustment[];
	/** What could not be deducted this period, per pay component. Empty in the ordinary case. */
	readonly shortfalls: readonly { readonly payComponentId: string; readonly amount: number }[];
};

/**
 * A company-direct entry costs the employer and never reaches the employee's net.
 *
 * `nature`, not `payComponent.nature`: derived overtime has no pay component to read it from, and
 * it is an EARNING like any other.
 */
function isCompanyDirect(item: PricedItem): boolean {
	return (
		item.payComponent?.definition?.source === 'ENTRY' &&
		item.payComponent.definition.settlement === 'COMPANY_DIRECT'
	);
}

/** Where a reducible deduction sits, so the guard can put the reduced amount back in place. */
type Reducible = {
	readonly plane: 'BASE' | 'ADJUSTMENT';
	readonly index: number;
	readonly amount: number;
	readonly component: NonNullable<PricedItem['payComponent']>;
};

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

	let base = options.base;
	let adjustments = options.adjustments;
	let otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
	let net = cents(gross - statutoryEmployee - otherDeductions + payments);
	const shortfalls: { payComponentId: string; amount: number }[] = [];

	if (net < 0) {
		// Reverse type sequence: the least essential deduction gives way first.
		// Only a configured deduction can be reduced: the guard shrinks what a company chose to
		// deduct, and derived overtime is neither a deduction nor anyone's to shrink.
		const collect = (items: readonly PricedItem[], plane: Reducible['plane']): Reducible[] =>
			items.flatMap((item, index) => {
				const component = item.payComponent;
				return item.nature === 'DEDUCTION' &&
					component != null &&
					!PROTECTED_DEDUCTION_TYPES.has(component.code)
					? [{ plane, index, amount: item.amount, component }]
					: [];
			});
		const reducible = [...collect(base, 'BASE'), ...collect(adjustments, 'ADJUSTMENT')].toSorted(
			(left, right) => Number(right.component.sequence) - Number(left.component.sequence)
		);
		const reducedBase = [...base];
		const reducedAdjustments = [...adjustments];
		let outstanding = -net;
		for (const entry of reducible) {
			if (outstanding <= 0) break;
			const relief = Math.min(entry.amount, outstanding);
			if (relief <= 0) continue;
			const amount = cents(entry.amount - relief);
			if (entry.plane === 'BASE') {
				const item = reducedBase[entry.index]!;
				reducedBase[entry.index] = {
					...item,
					amount,
					entry: { ...item.entry, amount }
				};
			} else {
				reducedAdjustments[entry.index] = { ...reducedAdjustments[entry.index]!, amount };
			}
			shortfalls.push({ payComponentId: entry.component.id, amount: cents(relief) });
			outstanding = cents(outstanding - relief);
		}
		base = reducedBase;
		adjustments = reducedAdjustments;
		otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
		net = cents(gross - statutoryEmployee - otherDeductions + payments);
	}

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
