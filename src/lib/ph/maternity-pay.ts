import type { Decimal } from '@norbital-ai/std/decimal';
import { dateKey, isCalendarDate } from '../iso-day.js';
import { addDays, daysBetween } from '../payroll/run/dates.js';
import { cents } from '../payroll/run/rounding.js';
import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';

type Amount = number | string | Decimal;

/** DOLE Department Advisory 01-2019 §II; tax treatment is superseded by BIR RMC 105-2019. */
export function calculatePhMaternityPay(input: {
	readonly monthly_salary: Amount;
	readonly leave_days: 60 | 105 | 120;
	readonly employee_premiums: {
		readonly sss: Amount;
		readonly philhealth: Amount;
		readonly pagibig: Amount;
	};
	readonly actual_sss_award: Amount;
}) {
	const money = (value: Amount, name: string) => {
		const amount = decodeNumber(value);
		if (
			!Number.isFinite(amount) ||
			amount < 0 ||
			Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7
		)
			refuse(`${name} needs a nonnegative peso amount with centavo precision.`);
		return amount;
	};
	if (![60, 105, 120].includes(input.leave_days))
		refuse('PH maternity full pay needs the statutory 60, 105 or 120 calendar days.');
	const monthly = money(input.monthly_salary, 'Monthly salary');
	if (monthly === 0) refuse('PH maternity full pay needs an evidenced positive monthly salary.');
	const sss = money(input.employee_premiums.sss, 'Employee SSS share');
	const philhealth = money(input.employee_premiums.philhealth, 'Employee PhilHealth share');
	const pagibig = money(input.employee_premiums.pagibig, 'Employee Pag-IBIG share');
	const award = money(input.actual_sss_award, 'Actual SSS award');
	if (award === 0) refuse('PH maternity pay needs the actual positive SSS award.');
	const premiumShares = cents(sss + philhealth + pagibig, 'PHP');
	// DA 01-2019's 14,006.75 × 3.5 example rounds the difference after the multiplication:
	// 49,023.625 − 2,984.07 − 49,000 = −2,960.45, not −2,960.44.
	const rawFullPay = (monthly * input.leave_days) / 30;
	const rawDifference = rawFullPay - premiumShares - award;
	const signedDifferential =
		rawDifference < 0 ? -cents(-rawDifference, 'PHP') : cents(rawDifference, 'PHP');
	const employerDifferential = Math.max(0, signedDifferential);
	return {
		full_pay: cents(rawFullPay, 'PHP'),
		employee_premium_shares: premiumShares,
		sss_award: award,
		signed_differential: signedDifferential,
		employer_differential: employerDifferential,
		/** Only a rank-and-file worker eligible for 13th-month pay uses this basic-salary component. */
		rank_and_file_13th_basic: employerDifferential,
		/** SSS benefit plus the employer differential; prior transfers must be offset from this. */
		employee_cash_entitlement: cents(award + employerDifferential, 'PHP')
	};
}

type Premiums = {
	readonly sss: Amount;
	readonly philhealth: Amount;
	readonly pagibig: Amount;
};

/** Split a peso total by positive day/amount weights, assigning centavo remainders cumulatively. */
function allocate(total: number, weights: readonly number[]): number[] {
	const sum = weights.reduce((amount, weight) => amount + weight, 0);
	if (sum <= 0 || weights.some((weight) => !Number.isFinite(weight) || weight < 0))
		refuse('Maternity cutoff allocation needs nonnegative, nonzero weights.');
	const centsTotal = Math.round(total * 100);
	let cumulative = 0;
	let prior = 0;
	return weights.map((weight) => {
		cumulative += weight;
		const through = Math.round((centsTotal * cumulative) / sum);
		const share = through - prior;
		prior = through;
		return share / 100;
	});
}

/** A case-wide accounting allocation; no payslip may use it without a saved, pinned case link. */
export function allocatePhMaternityPay(input: {
	readonly leave_from: string;
	readonly leave_through: string;
	readonly monthly_salary: Amount;
	readonly actual_sss_award: Amount;
	readonly cutoffs: readonly {
		readonly period: string;
		readonly from: string;
		readonly through: string;
		readonly pay_on: string;
		readonly employee_premiums: Premiums;
	}[];
	readonly employee_cash: readonly {
		readonly kind: 'SSS_ADVANCE' | 'SALARY_DIFFERENTIAL';
		readonly paid_on: string;
		readonly amount: Amount;
	}[];
}) {
	const from = dateKey(input.leave_from);
	const through = dateKey(input.leave_through);
	if (!isCalendarDate(from) || !isCalendarDate(through) || through < from)
		refuse('Maternity cutoff allocation needs an ordered complete leave span.');
	const days = daysBetween(from, through);
	if (![60, 105, 120].includes(days.length) || input.cutoffs.length === 0)
		refuse('Maternity cutoff allocation needs the statutory full span and at least one cutoff.');
	let next = from;
	let priorPay = '';
	const cutoffDays = input.cutoffs.map((cutoff) => {
		const start = dateKey(cutoff.from);
		const end = dateKey(cutoff.through);
		const paid = dateKey(cutoff.pay_on);
		if (
			!cutoff.period.trim() ||
			!isCalendarDate(start) ||
			!isCalendarDate(end) ||
			!isCalendarDate(paid) ||
			start !== next ||
			end < start ||
			end > through ||
			paid < priorPay
		)
			refuse(
				'Maternity cutoff dates must cover consecutive days once, with ordered payment dates.'
			);
		next = addDays(end, 1);
		priorPay = paid;
		return daysBetween(start, end);
	});
	if (next !== addDays(through, 1))
		refuse('Maternity cutoff dates must cover the complete leave span.');
	const amount = (value: Amount, label: string) => {
		const n = decodeNumber(value);
		if (!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-7)
			refuse(`${label} needs a nonnegative peso amount with centavo precision.`);
		return n;
	};
	const byCutoffPremiums = input.cutoffs.map((cutoff) => ({
		sss: amount(cutoff.employee_premiums.sss, 'Employee SSS share'),
		philhealth: amount(cutoff.employee_premiums.philhealth, 'Employee PhilHealth share'),
		pagibig: amount(cutoff.employee_premiums.pagibig, 'Employee Pag-IBIG share')
	}));
	const sumPremium = (key: keyof Premiums) =>
		cents(
			byCutoffPremiums.reduce((total, row) => total + row[key], 0),
			'PHP'
		);
	const casePay = calculatePhMaternityPay({
		monthly_salary: input.monthly_salary,
		leave_days: days.length as 60 | 105 | 120,
		employee_premiums: {
			sss: sumPremium('sss'),
			philhealth: sumPremium('philhealth'),
			pagibig: sumPremium('pagibig')
		},
		actual_sss_award: input.actual_sss_award
	});
	const lengths = cutoffDays.map((covered) => covered.length);
	const fullShares = allocate(casePay.full_pay, lengths);
	const sssShares = allocate(casePay.sss_award, lengths);
	const premiumShares = byCutoffPremiums.map((row) =>
		cents(row.sss + row.philhealth + row.pagibig, 'PHP')
	);
	const localDifferentials = fullShares.map((full, index) =>
		cents(full - premiumShares[index]! - sssShares[index]!, 'PHP')
	);
	if (casePay.employer_differential > 0 && localDifferentials.some((value) => value < 0))
		refuse(
			'Maternity cutoff allocation has a negative local differential; record a supported allocation before settlement.'
		);
	const differentialShares =
		casePay.employer_differential === 0
			? lengths.map(() => 0)
			: allocate(casePay.employer_differential, localDifferentials);
	const cash = input.employee_cash.map((row) => ({
		kind: row.kind,
		paid_on: dateKey(row.paid_on),
		amount: amount(row.amount, 'Employee maternity cash')
	}));
	if (cash.some((row) => !isCalendarDate(row.paid_on) || row.amount <= 0))
		refuse('Employee maternity cash needs a real payment day and positive amount.');
	const cashOf = (kind: 'SSS_ADVANCE' | 'SALARY_DIFFERENTIAL') =>
		cents(
			cash.filter((row) => row.kind === kind).reduce((total, row) => total + row.amount, 0),
			'PHP'
		);
	if (
		cashOf('SSS_ADVANCE') > casePay.sss_award ||
		cashOf('SALARY_DIFFERENTIAL') > casePay.employer_differential ||
		cash.some((row) => row.paid_on > priorPay)
	)
		refuse(
			'Recorded maternity cash exceeds its component or falls after the final cutoff payment.'
		);
	if (cash.some((row) => row.paid_on > dateKey(input.cutoffs[0]!.pay_on)))
		refuse(
			'Maternity cash after the first cutoff needs settled payslip allocations before replanning.'
		);
	let appliedSssCash = 0;
	let appliedDifferentialCash = 0;
	const perCutoff = input.cutoffs.map((cutoff, index) => {
		const entitlement = cents(sssShares[index]! + differentialShares[index]!, 'PHP');
		const priorSssCashApplied = Math.min(
			sssShares[index]!,
			Math.max(0, cents(cashOf('SSS_ADVANCE') - appliedSssCash, 'PHP'))
		);
		const priorDifferentialCashApplied = Math.min(
			differentialShares[index]!,
			Math.max(0, cents(cashOf('SALARY_DIFFERENTIAL') - appliedDifferentialCash, 'PHP'))
		);
		appliedSssCash = cents(appliedSssCash + priorSssCashApplied, 'PHP');
		appliedDifferentialCash = cents(appliedDifferentialCash + priorDifferentialCashApplied, 'PHP');
		const priorCashApplied = cents(priorSssCashApplied + priorDifferentialCashApplied, 'PHP');
		const years = new Map<string, number>();
		for (const day of cutoffDays[index]!)
			years.set(day.slice(0, 4), (years.get(day.slice(0, 4)) ?? 0) + 1);
		const yearShares = allocate(differentialShares[index]!, [...years.values()]);
		return {
			period: cutoff.period,
			from: dateKey(cutoff.from),
			through: dateKey(cutoff.through),
			full_pay: fullShares[index]!,
			employee_premium_shares: premiumShares[index]!,
			sss_award_share: sssShares[index]!,
			employer_differential: differentialShares[index]!,
			rank_and_file_13th_basic_by_year: Object.fromEntries(
				[...years.keys()].map((year, yearIndex) => [year, yearShares[yearIndex]!])
			),
			prior_sss_cash_applied: priorSssCashApplied,
			prior_differential_cash_applied: priorDifferentialCashApplied,
			prior_cash_applied: priorCashApplied,
			payroll_cash_transfer: cents(entitlement - priorCashApplied, 'PHP')
		};
	});
	return { ...casePay, cutoffs: perCutoff };
}
