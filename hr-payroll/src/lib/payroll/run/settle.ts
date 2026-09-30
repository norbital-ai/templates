/**
 * Step 7 — SETTLE: four numbers from each line's bucket and the statutory charges.
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
 * Sums run over base and adjustments alike. A reimbursement is added to net, never to gross; an
 * EMPLOYER entry costs the employer only. A loan repayment is recovered whole or not at all: when
 * net would go negative, or past the version's `deduction_ceiling`, whole recoveries are dropped in
 * reverse order and stay outstanding. A statutory shortfall is recorded apart from cash and
 * authorises no later recovery; a deficit from other deductions is refused.
 */

import { refuse } from '../../../lib/refuse.js';
import type { ContributionCharge } from './contribute.js';
import type {
	MeasuredAdjustment,
	MeasuredBase,
	PricedItem,
	SettlementBucket
} from '../../../lib/payroll/family.js';
import { cents, currencyFractionDigits, roundMoney } from './rounding.js';
import type { PayrollSettings } from '../../../lib/datatypes/payroll_settings.js';
import type { MonthPrior } from './accumulate.js';

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
		readonly cause?: 'DEDUCTION_CEILING' | undefined;
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
	readonly employeeNumber?: string | undefined;
	/** The version's cap on deductions; absent is none. */
	readonly ceiling?: PayrollSettings['deduction_ceiling'] | undefined;
	/** Earlier payslips in this month, for a law whose deduction limit is monthly. */
	readonly monthPrior?: MonthPrior | undefined;
	/** Whether this is the contract's last payslip, which a ceiling may exempt. */
	readonly finalPay?: boolean | undefined;
}): Settlement {
	const { currency } = options;
	const scale = 10 ** currencyFractionDigits(currency);
	const floorLimit = (value: number) => roundMoney(value * scale, 'FLOOR_UNIT') / scale;
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
	const excludedSalary = [...options.base, ...options.adjustments].reduce((total, item) => {
		if (!options.ceiling?.basis_exempt_codes?.includes(item.catalogueComponent.code)) return total;
		return (
			total +
			(item.bucket === 'EARNING' ? item.amount : item.bucket === 'ABSENCE' ? -item.amount : 0)
		);
	}, 0);
	const salary = Math.max(0, cents(gross - excludedSalary, currency));
	const priorLines = options.monthPrior?.accumulation.lines ?? [];
	const priorSalary = priorLines.reduce(
		(total, item) =>
			total +
			(options.ceiling?.basis_exempt_codes?.includes(item.code)
				? 0
				: item.bucket === 'EARNING'
					? item.amount
					: item.bucket === 'ABSENCE'
						? -item.amount
						: 0),
		0
	);

	const base = options.base;
	let adjustments = options.adjustments;
	let otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
	let net = cents(gross - statutoryEmployee - otherDeductions + payments, currency);
	const shortfalls: Settlement['shortfalls'][number][] = [];
	const recovers = (item: MeasuredAdjustment): boolean =>
		item.input.family === 'LOAN_REPAYMENT' && item.bucket === 'DEDUCTION' && item.amount > 0;

	// This limit is independent of the aggregate ceiling and its final-pay exemption. Keep each
	// instalment whole and outstanding when it exceeds the limit; never round the lawful cap up.
	const instalmentShare = options.ceiling?.loan_instalment_share;
	if (instalmentShare != null) {
		adjustments = adjustments.filter((item) => {
			if (
				!recovers(item) ||
				options.ceiling?.loan_instalment_exempt_codes?.includes(item.catalogueComponent.code) ||
				item.amount <= floorLimit(salary * instalmentShare)
			)
				return true;
			shortfalls.push({
				componentCatalogueId: item.catalogueComponent.id,
				amount: item.amount,
				cause: 'DEDUCTION_CEILING'
			});
			return false;
		});
		otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
		net = cents(gross - statutoryEmployee - otherDeductions + payments, currency);
	}

	let ceilingExcess = 0;
	for (const group of options.ceiling?.group_limits ?? []) {
		const earlier = group.assessment_period === 'MONTH' ? priorLines : [];
		const amounts = [...base, ...adjustments]
			.filter(
				(item) => item.bucket === 'DEDUCTION' && group.codes.includes(item.catalogueComponent.code)
			)
			.map((item) => item.amount);
		const deducted = group.per_entry
			? Math.max(0, ...amounts)
			: amounts.reduce((total, amount) => total + amount, 0) +
				earlier.reduce(
					(total, item) =>
						total +
						(item.bucket === 'DEDUCTION' && group.codes.includes(item.code) ? item.amount : 0),
					0
				);
		const limit = floorLimit(
			group.share * Math.max(0, salary + (group.assessment_period === 'MONTH' ? priorSalary : 0))
		);
		ceilingExcess = Math.max(ceilingExcess, cents(deducted - limit, currency));
	}
	const ceiling = options.finalPay && options.ceiling?.final_pay_exempt ? null : options.ceiling;
	if (ceiling != null) {
		const earlier = ceiling.assessment_period === 'MONTH' ? priorLines : [];
		const assessmentSalary = Math.max(
			0,
			salary + (ceiling.assessment_period === 'MONTH' ? priorSalary : 0)
		);
		const priorCharges =
			ceiling.assessment_period === 'MONTH' ? [...(options.monthPrior?.charged ?? [])] : [];
		const assessmentStatutory =
			statutoryEmployee + priorCharges.reduce((total, [, charge]) => total + charge.employee, 0);
		const statutoryBase =
			options.charges.reduce(
				(total, charge) =>
					total +
					(ceiling.basis_statutory_codes == null ||
					ceiling.basis_statutory_codes.includes(charge.contribution.row.code)
						? charge.employee
						: 0),
				0
			) +
			priorCharges.reduce(
				(total, [code, charge]) =>
					total +
					(ceiling.basis_statutory_codes == null || ceiling.basis_statutory_codes.includes(code)
						? charge.employee
						: 0),
				0
			);
		const counts = (
			code: string,
			family: PricedItem['catalogueComponent']['family'],
			bucket: SettlementBucket,
			finalPay: boolean
		): boolean =>
			bucket === 'DEDUCTION' &&
			!ceiling.exempt_codes.includes(code) &&
			!(finalPay && ceiling.final_pay_exempt_codes?.includes(code)) &&
			(family !== 'LOAN' ||
				(ceiling.counts_loans && !(finalPay && ceiling.final_pay_exempts_loans)));
		const counted = (item: PricedItem) =>
			counts(
				item.catalogueComponent.code,
				item.catalogueComponent.family,
				item.bucket,
				options.finalPay === true
			);
		const uncappedPayment = Math.max(
			0,
			[...base, ...adjustments].reduce(
				(total, item) =>
					!ceiling.uncapped_payment_codes?.includes(item.catalogueComponent.code)
						? total
						: total +
							(item.bucket === 'EARNING' || item.bucket === 'NON_WAGE_PAYMENT'
								? item.amount
								: item.bucket === 'ABSENCE'
									? -item.amount
									: 0),
				0
			) +
				earlier.reduce(
					(total, item) =>
						total +
						(!ceiling.uncapped_payment_codes?.includes(item.code)
							? 0
							: item.bucket === 'EARNING' || item.bucket === 'NON_WAGE_PAYMENT'
								? item.amount
								: item.bucket === 'ABSENCE'
									? -item.amount
									: 0),
					0
				)
		);
		const room =
			ceiling.share *
				(assessmentSalary - (ceiling.basis === 'NET_OF_STATUTORY' ? statutoryBase : 0)) -
			(ceiling.counts_statutory ? assessmentStatutory : 0) +
			uncappedPayment;
		let countedTotal = [...base, ...adjustments].reduce(
			(total, item) => total + (counted(item) ? item.amount : 0),
			earlier.reduce(
				(total, item) =>
					total + (counts(item.code, item.family, item.bucket, false) ? item.amount : 0),
				0
			)
		);
		const extension = ceiling.approved_loan_extension;
		const extendsRoom = (item: MeasuredAdjustment) =>
			recovers(item) && counted(item) && extension?.codes.includes(item.catalogueComponent.code);
		let extensionTotal = adjustments.reduce(
			(total, item) => total + (extendsRoom(item) ? item.amount : 0),
			earlier.reduce(
				(total, item) =>
					total +
					(item.family === 'LOAN' &&
					counts(item.code, item.family, item.bucket, false) &&
					extension?.codes.includes(item.code)
						? item.amount
						: 0),
				0
			)
		);
		const excess = () =>
			cents(
				Math.min(
					countedTotal,
					countedTotal -
						floorLimit(room + Math.min(extensionTotal, assessmentSalary * (extension?.share ?? 0)))
				),
				currency
			);
		// Statutory charges the run cannot shorten: only the counted deductions can be over.
		let over = excess();
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
					countedTotal = cents(countedTotal - item.amount, currency);
					if (extendsRoom(item)) extensionTotal = cents(extensionTotal - item.amount, currency);
					over = excess();
					continue;
				}
				kept.push(item);
			}
			adjustments = kept.toReversed();
			otherDeductions = sumOf(base, 'DEDUCTION') + sumOf(adjustments, 'DEDUCTION');
			net = cents(gross - statutoryEmployee - otherDeductions + payments, currency);
		}
		ceilingExcess = Math.max(ceilingExcess, over);
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
