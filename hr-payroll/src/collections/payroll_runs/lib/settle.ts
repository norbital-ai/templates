/**
 * Step 7 — SETTLE.
 *
 * Four numbers, derived entirely from the bucket each priced line settles in and the
 * statutory charges. Nothing here reads a component code.
 *
 * ```
 * gross            = Σ EARNING − Σ ABSENCE
 * statutory (ee)   = Σ payslips.statutory[].employee_amount
 * other deductions = Σ DEDUCTION
 * payments         = Σ NON_WAGE_PAYMENT
 *
 * balance          = gross − statutory − other + payments
 * net              = max(0, balance)
 * unfunded         = max(0, −balance)
 * employer cost    = Σ employer_amount + Σ EMPLOYER_COST
 * ```
 *
 * The sums run over **both planes at once** — the contracted amounts inlined on the payslip and the
 * adjustments each input caused — because gross is a fact about the payslip and not about which
 * table a figure ended up in. Which plane an amount belongs to is decided by what caused it, in
 * MEASURE; nothing here re-decides it, and nothing here reshapes one plane into the other.
 *
 * `total_deductions` includes the employee's statutory contributions and excludes reimbursements.
 * A payroll-settled reimbursement repays the employee's own outlay, so it is added to net without
 * ever having been part of gross. An `EMPLOYER` entry (for example, a panel-clinic invoice) costs
 * the employer: the row remains on the payslip for provenance, but no cash passes through the
 * employee.
 *
 * A loan repayment is recovered whole or not at all: one repayment row is one payslip line on one
 * payslip. When net would go negative, whole recoveries are dropped in reverse emission order and
 * the row stays unlinked, so the next regular run recovers it. The same happens first where the
 * version caps deductions (`payroll.deduction_ceiling`): whole recoveries it counts are dropped
 * until the counted deductions fit, and what still exceeds it is reported, never cut. Single-use
 * entries and statutory charges remain assessed in full. A statutory shortfall is recorded separately from cash pay;
 * it does not authorize recovery from later wages. A deficit from non-statutory items is refused.
 */

import { refuse } from '@norbital-ai/bolt/authoring';
import type { ContributionCharge } from './contribute.js';
import type {
	MeasuredAdjustment,
	MeasuredBase,
	PricedItem,
	SettlementBucket
} from '../../../lib/payroll/family.js';
import { cents } from './rounding.js';
import type { PayrollSettings } from '../../../datatypes/payroll_settings/+definition.js';

export type Settlement = {
	readonly gross: number;
	readonly totalDeductions: number;
	readonly net: number;
	readonly unfundedContributions: number;
	readonly employerCost: number;
	/** Both planes after the guard has run; identical to the input when net never went negative. */
	readonly base: readonly MeasuredBase[];
	readonly adjustments: readonly MeasuredAdjustment[];
	/** The whole loan recoveries the guard dropped this period, per component. Empty in the ordinary case. */
	readonly shortfalls: readonly {
		readonly componentCatalogueId: string;
		readonly amount: number;
		/** Dropped to fit the deduction ceiling; absent is dropped to keep net pay from going negative. */
		readonly cause?: 'DEDUCTION_CEILING';
	}[];
	/** What the counted deductions still exceed the deduction ceiling by once recoveries are dropped. */
	readonly ceilingExcess: number;
};

export function settle(options: {
	readonly base: readonly MeasuredBase[];
	readonly adjustments: readonly MeasuredAdjustment[];
	readonly charges: readonly ContributionCharge[];
	/** The payroll currency the four figures are rounded to the minor unit of. */
	readonly currency: string;
	/** Who is being settled, for the refusal that names them. */
	readonly employeeNumber?: string;
	/** The version's cap on deductions; absent is none. */
	readonly ceiling?: PayrollSettings['deduction_ceiling'];
	/** Whether this is the contract's last payslip, which a ceiling may exempt. */
	readonly finalPay?: boolean;
}): Settlement {
	const { currency } = options;
	const statutoryEmployee = options.charges.reduce((total, charge) => total + charge.employee, 0);
	const statutoryEmployer = options.charges.reduce((total, charge) => total + charge.employer, 0);

	const sumOf = (items: readonly PricedItem[], bucket: SettlementBucket): number =>
		items.reduce((total, item) => total + (item.bucket === bucket ? item.amount : 0), 0);
	const gross = cents(
		sumOf(options.base, 'EARNING') +
			sumOf(options.adjustments, 'EARNING') -
			sumOf(options.base, 'ABSENCE') -
			sumOf(options.adjustments, 'ABSENCE'),
		currency
	);
	const paymentsOf = (items: readonly PricedItem[]): number => sumOf(items, 'NON_WAGE_PAYMENT');
	const employerOf = (items: readonly PricedItem[]): number => sumOf(items, 'EMPLOYER_COST');
	const payments = paymentsOf(options.base) + paymentsOf(options.adjustments);
	const employerAmounts = employerOf(options.base) + employerOf(options.adjustments);

	const base = options.base;
	let adjustments = options.adjustments;
	let otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
	let net = cents(gross - statutoryEmployee - otherDeductions + payments, currency);
	const shortfalls: Settlement['shortfalls'][number][] = [];
	const recovers = (item: MeasuredAdjustment): boolean =>
		item.input.family === 'LOAN_REPAYMENT' && item.bucket === 'DEDUCTION' && item.amount > 0;

	let ceilingExcess = 0;
	const ceiling = options.finalPay && options.ceiling?.final_pay_exempt ? null : options.ceiling;
	if (ceiling != null) {
		const countsLoans =
			ceiling.counts_loans && !(options.finalPay && ceiling.final_pay_exempts_loans === true);
		const counted = (item: PricedItem): boolean =>
			item.bucket === 'DEDUCTION' &&
			!ceiling.exempt_codes.includes(item.catalogueComponent.code) &&
			(countsLoans || item.catalogueComponent.family !== 'LOAN');
		const room =
			ceiling.share * (gross - (ceiling.basis === 'NET_OF_STATUTORY' ? statutoryEmployee : 0)) -
			(ceiling.counts_statutory ? statutoryEmployee : 0);
		const countedTotal = [...base, ...adjustments].reduce(
			(total, item) => total + (counted(item) ? item.amount : 0),
			0
		);
		// Statutory charges the run cannot shorten: only the counted deductions can be over.
		let over = cents(Math.min(countedTotal, countedTotal - room), currency);
		if (over > 0) {
			// Drop whole counted recoveries, last emitted first, until the rest fits.
			const kept: MeasuredAdjustment[] = [];
			for (const item of adjustments.toReversed()) {
				if (over > 0 && recovers(item) && counted(item)) {
					shortfalls.push({
						componentCatalogueId: item.catalogueComponent.id,
						amount: item.amount,
						cause: 'DEDUCTION_CEILING'
					});
					over = cents(over - item.amount, currency);
					continue;
				}
				kept.push(item);
			}
			adjustments = kept.toReversed();
			otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
			net = cents(gross - statutoryEmployee - otherDeductions + payments, currency);
		}
		ceilingExcess = Math.max(0, over);
	}

	if (net < 0) {
		// Drop whole recoveries, last emitted first, until net is no longer negative.
		let outstanding = -net;
		const kept: MeasuredAdjustment[] = [];
		for (const item of adjustments.toReversed()) {
			if (recovers(item) && outstanding > 0) {
				shortfalls.push({ componentCatalogueId: item.catalogueComponent.id, amount: item.amount });
				outstanding = cents(outstanding - item.amount, currency);
				continue;
			}
			kept.push(item);
		}
		adjustments = kept.toReversed();
		otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
		net = cents(gross - statutoryEmployee - otherDeductions + payments, currency);
	}

	if (cents(gross - otherDeductions + payments, currency) < 0)
		refuse(
			`Payroll net pay is negative${options.employeeNumber == null ? '' : ` for ${options.employeeNumber}`} ` +
				`(gross ${gross}, statutory ${cents(statutoryEmployee, currency)}, other deductions ${cents(otherDeductions, currency)}, payments ${cents(payments, currency)}; ` +
				[...base, ...adjustments]
					.map((item) => `${item.label} ${item.bucket} ${item.amount}`)
					.join(', ') +
				'). Resolve the approved recovery before calculating this period.'
		);

	return {
		gross,
		totalDeductions: cents(statutoryEmployee + otherDeductions, currency),
		net: Math.max(0, net),
		unfundedContributions: Math.max(0, -net),
		employerCost: cents(statutoryEmployer + employerAmounts, currency),
		base,
		adjustments,
		shortfalls,
		ceilingExcess
	};
}
