import type { Decimal } from '@norbital-ai/std/decimal';
import type { BenefitCaseType } from '../datatypes/case_types.js';
import { dateKey, isCalendarDate } from '../iso-day.js';
import { addDays, daysBetween } from '../payroll/run/dates.js';
import { readRange } from '../payroll/run/effective.js';
import { cents } from '../payroll/run/rounding.js';
import { refuse } from '../refuse.js';
import { decodeNumber } from '../wire.js';
import {
	advanceDue,
	casePhases,
	caseSite,
	compensableDays,
	employeePaymentKinds,
	employerPays,
	movementKind,
	type CaseEvidence,
	type CaseFacts
} from './benefit.js';
import { reconcileBenefitCase } from './reconciliation.js';

type Amount = number | string | Decimal;
type Premiums = Readonly<Record<string, Amount>>;

const money = (value: Amount, name: string) => {
	const amount = decodeNumber(value);
	if (
		!Number.isFinite(amount) ||
		amount < 0 ||
		Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7
	)
		refuse(`${name} needs a nonnegative amount to the cent.`);
	return amount;
};

/** Each declared scheme's employee share, and no other. */
function premiumShares(type: BenefitCaseType, premiums: Premiums): Record<string, number> {
	const extra = Object.keys(premiums).find((code) => !type.premium_schemes.includes(code));
	if (extra != null) refuse(`${type.case_type} full pay is not net of a ${extra} share.`);
	return Object.fromEntries(
		type.premium_schemes.map((code) => {
			if (!Object.hasOwn(premiums, code)) refuse(`Employee ${code} share is required.`);
			return [code, money(premiums[code]!, `Employee ${code} share`)];
		})
	);
}

/**
 * The case priced at pay time: the phases over the evidenced monthly salary, the employee's premium
 * shares and the actual award (`case.salary`, `case.premiums`, `case.award`). Full pay is the
 * phases' `wage`; the employer's differential is their `employer_pays`, never negative. Every
 * figure and its rounding is the case type's; this only sums the phases.
 */
export function calculateBenefitPay(input: {
	readonly case_type: BenefitCaseType;
	readonly currency: string;
	readonly benefit_case: CaseFacts;
	readonly evidence?: readonly CaseEvidence[] | undefined;
	readonly monthly_salary: Amount;
	readonly employee_premiums: Premiums;
	readonly actual_award: Amount;
}) {
	const type = input.case_type;
	const monthly = money(input.monthly_salary, 'Monthly salary');
	if (monthly === 0) refuse('Benefit full pay needs an evidenced positive monthly salary.');
	const shares = premiumShares(type, input.employee_premiums);
	const award = money(input.actual_award, 'Actual award');
	if (award === 0) refuse('Benefit pay needs the actual positive award.');
	const premiums = cents(
		Object.values(shares).reduce((sum, share) => sum + share, 0),
		input.currency
	);
	const phases = casePhases(
		type,
		caseSite(type, input.benefit_case, input.evidence, { salary: monthly, premiums, award }),
		input.currency
	);
	const total = (pick: (phase: (typeof phases)[number]) => number) =>
		cents(
			phases.reduce((sum, phase) => sum + pick(phase), 0),
			input.currency
		);
	const signedDifferential = total((phase) => phase.employer_pays);
	const employerDifferential = employerPays(signedDifferential);
	return {
		compensable_days: phases.reduce((sum, phase) => sum + phase.days, 0),
		full_pay: total((phase) => phase.wage),
		employee_premium_shares: premiums,
		award,
		signed_differential: signedDifferential,
		employer_differential: employerDifferential,
		/** The differential is basic salary; the award is not. */
		basic_salary_share: employerDifferential,
		/** The award plus the employer differential; prior transfers are offset from this. */
		employee_cash_entitlement: cents(award + employerDifferential, input.currency),
		phases
	};
}

/** Split a total by nonnegative weights, assigning cent remainders cumulatively. */
function allocate(total: number, weights: readonly number[]): number[] {
	const sum = weights.reduce((amount, weight) => amount + weight, 0);
	if (sum <= 0 || weights.some((weight) => !Number.isFinite(weight) || weight < 0))
		refuse('Benefit cutoff allocation needs nonnegative, nonzero weights.');
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
export function allocateBenefitPay(input: {
	readonly case_type: BenefitCaseType;
	readonly currency: string;
	readonly benefit_case: CaseFacts;
	readonly evidence?: readonly CaseEvidence[] | undefined;
	readonly leave_from: string;
	readonly leave_through: string;
	readonly monthly_salary: Amount;
	readonly actual_award: Amount;
	readonly cutoffs: readonly {
		readonly period: string;
		readonly from: string;
		readonly through: string;
		readonly pay_on: string;
		readonly employee_premiums: Premiums;
	}[];
	readonly employee_cash: readonly {
		readonly kind: string;
		readonly paid_on: string;
		readonly amount: Amount;
	}[];
}) {
	const type = input.case_type;
	const from = dateKey(input.leave_from);
	const through = dateKey(input.leave_through);
	if (!isCalendarDate(from) || !isCalendarDate(through) || through < from)
		refuse('Benefit cutoff allocation needs an ordered complete leave span.');
	const days = daysBetween(from, through);
	const compensable = compensableDays(type, caseSite(type, input.benefit_case, input.evidence));
	if (days.length !== compensable || input.cutoffs.length === 0)
		refuse(
			`Benefit cutoff allocation needs the case's ${compensable} compensable days and at least one cutoff.`
		);
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
			refuse('Benefit cutoff dates must cover consecutive days once, with ordered payment dates.');
		next = addDays(end, 1);
		priorPay = paid;
		return daysBetween(start, end);
	});
	if (next !== addDays(through, 1))
		refuse('Benefit cutoff dates must cover the complete leave span.');
	const byCutoffPremiums = input.cutoffs.map((cutoff) =>
		premiumShares(type, cutoff.employee_premiums)
	);
	const casePay = calculateBenefitPay({
		case_type: type,
		currency: input.currency,
		benefit_case: input.benefit_case,
		evidence: input.evidence,
		monthly_salary: input.monthly_salary,
		employee_premiums: Object.fromEntries(
			type.premium_schemes.map((code) => [
				code,
				cents(
					byCutoffPremiums.reduce((total, row) => total + row[code]!, 0),
					input.currency
				)
			])
		),
		actual_award: input.actual_award
	});
	const lengths = cutoffDays.map((covered) => covered.length);
	const fullShares = allocate(casePay.full_pay, lengths);
	const awardShares = allocate(casePay.award, lengths);
	const premiumTotals = byCutoffPremiums.map((row) =>
		cents(
			Object.values(row).reduce((sum, share) => sum + share, 0),
			input.currency
		)
	);
	const localDifferentials = fullShares.map((full, index) =>
		cents(full - premiumTotals[index]! - awardShares[index]!, input.currency)
	);
	if (casePay.employer_differential > 0 && localDifferentials.some((value) => value < 0))
		refuse(
			'Benefit cutoff allocation has a negative local differential; record a supported allocation before settlement.'
		);
	const differentialShares =
		casePay.employer_differential === 0
			? lengths.map(() => 0)
			: allocate(casePay.employer_differential, localDifferentials);
	const cash = input.employee_cash.map((row) => {
		const declared = movementKind(type, row.kind);
		if (declared.direction !== 'EMPLOYEE_PAYMENT')
			refuse('Only money paid to the employee is employee benefit cash.');
		return {
			component: declared.component,
			paid_on: dateKey(row.paid_on),
			amount: money(row.amount, 'Employee benefit cash')
		};
	});
	if (cash.some((row) => !isCalendarDate(row.paid_on) || row.amount <= 0))
		refuse('Employee benefit cash needs a real payment day and positive amount.');
	const cashOf = (component: string) =>
		cents(
			cash
				.filter((row) => row.component === component)
				.reduce((total, row) => total + row.amount, 0),
			input.currency
		);
	const awardCash = cashOf(type.components.award);
	const differentialCash = cashOf(type.components.differential);
	if (
		awardCash > casePay.award ||
		differentialCash > casePay.employer_differential ||
		cash.some((row) => row.paid_on > priorPay)
	)
		refuse('Recorded benefit cash exceeds its component or falls after the final cutoff payment.');
	if (cash.some((row) => row.paid_on > dateKey(input.cutoffs[0]!.pay_on)))
		refuse(
			'Benefit cash after the first cutoff needs settled payslip allocations before replanning.'
		);
	let appliedAward = 0;
	let appliedDifferential = 0;
	const perCutoff = input.cutoffs.map((cutoff, index) => {
		const entitlement = cents(awardShares[index]! + differentialShares[index]!, input.currency);
		const priorAwardCashApplied = Math.min(
			awardShares[index]!,
			Math.max(0, cents(awardCash - appliedAward, input.currency))
		);
		const priorDifferentialCashApplied = Math.min(
			differentialShares[index]!,
			Math.max(0, cents(differentialCash - appliedDifferential, input.currency))
		);
		appliedAward = cents(appliedAward + priorAwardCashApplied, input.currency);
		appliedDifferential = cents(appliedDifferential + priorDifferentialCashApplied, input.currency);
		const priorCashApplied = cents(
			priorAwardCashApplied + priorDifferentialCashApplied,
			input.currency
		);
		const years = new Map<string, number>();
		for (const day of cutoffDays[index]!)
			years.set(day.slice(0, 4), (years.get(day.slice(0, 4)) ?? 0) + 1);
		const yearShares = allocate(differentialShares[index]!, [...years.values()]);
		return {
			period: cutoff.period,
			from: dateKey(cutoff.from),
			through: dateKey(cutoff.through),
			full_pay: fullShares[index]!,
			employee_premium_shares: premiumTotals[index]!,
			award_share: awardShares[index]!,
			employer_differential: differentialShares[index]!,
			basic_salary_share_by_year: Object.fromEntries(
				[...years.keys()].map((year, yearIndex) => [year, yearShares[yearIndex]!])
			),
			prior_award_cash_applied: priorAwardCashApplied,
			prior_differential_cash_applied: priorDifferentialCashApplied,
			prior_cash_applied: priorCashApplied,
			payroll_cash_transfer: cents(entitlement - priorCashApplied, input.currency)
		};
	});
	return { ...casePay, cutoffs: perCutoff };
}

type ReconciliationInput = Parameters<typeof reconcileBenefitCase>[0];
type Case = ReconciliationInput['benefit_case'] & {
	readonly id: string;
	readonly awarded_on?: string | null | undefined;
	readonly award_reference?: string | null | undefined;
	readonly award_file?: unknown;
};
type Movement = ReconciliationInput['movements'][number] & { readonly benefit_case_id: string };
type Payslip = ReconciliationInput['payslips'][number] & {
	readonly salary_window?: { readonly start: string; readonly end: string } | null;
};

/** Adapt saved case evidence into a proposed slip ledger; the payroll write still needs atomic pins. */
export function planBenefitCasePayslips(input: {
	readonly case_type: BenefitCaseType;
	readonly currency: string;
	readonly benefit_case: Case;
	readonly evidence?: readonly CaseEvidence[] | undefined;
	readonly entries: ReconciliationInput['entries'];
	readonly payslips: readonly Payslip[];
	readonly movements: readonly Movement[];
	readonly as_of: string;
	readonly wage_basis: {
		readonly monthly_salary: Amount;
		readonly monthly_salary_reference: string;
		readonly full_span_wage_period: {
			readonly period: unknown;
			readonly currency: string;
			readonly normal_wages: Amount;
			readonly reference: string;
		};
	};
	readonly cutoffs: readonly {
		readonly period: string;
		readonly salary: { readonly start: string; readonly end: string };
		readonly pay_on: string;
		readonly leave_entry_ids: readonly string[];
		readonly employee_premiums: Premiums;
		readonly premium_evidence_reference: string;
	}[];
}) {
	const type = input.case_type;
	const caseRow = input.benefit_case;
	const from = dateKey(caseRow.leave_from);
	const through = dateKey(caseRow.leave_through);
	const wageSpan = readRange(input.wage_basis.full_span_wage_period.period);
	if (
		!isCalendarDate(from) ||
		!isCalendarDate(through) ||
		wageSpan == null ||
		dateKey(wageSpan.start) !== from ||
		dateKey(wageSpan.end) !== through ||
		input.wage_basis.full_span_wage_period.currency !== input.currency ||
		!input.wage_basis.full_span_wage_period.reference.trim() ||
		!input.wage_basis.monthly_salary_reference.trim()
	)
		refuse(
			`Benefit pay needs referenced monthly salary and exact full-span ${input.currency} wage evidence.`
		);
	if (
		caseRow.award_amount == null ||
		!isCalendarDate(dateKey(caseRow.awarded_on)) ||
		dateKey(caseRow.awarded_on) > dateKey(input.as_of) ||
		!(caseRow.award_reference ?? '').trim() ||
		caseRow.award_file == null
	)
		refuse('Benefit pay needs a current actual award amount, date, reference and document.');
	const own = input.movements.filter((row) => row.benefit_case_id === caseRow.id);
	const reconciliation = reconcileBenefitCase({
		case_type: type,
		benefit_case: caseRow,
		evidence: input.evidence,
		entries: input.entries,
		payslips: input.payslips,
		movements: own,
		as_of: input.as_of
	});
	if (reconciliation.leave.status !== 'COMPLETE_APPROVED_SPAN')
		refuse('Benefit pay needs the complete approved continuous event-matched leave span.');
	if (reconciliation.payroll.captured_entries > 0)
		refuse('An existing benefit payslip needs its saved case allocation before replanning.');
	const matchedIds = new Set(reconciliation.leave.entry_ids);
	const reversedIds = new Set(
		input.entries.flatMap((entry) =>
			entry.approval_id == null && entry.as_adjustment_entry && entry.reversal_of_id != null
				? [entry.reversal_of_id]
				: []
		)
	);
	for (const entry of input.entries) {
		if (
			entry.employment_id !== caseRow.employment_id ||
			entry.leave_code !== type.case_type ||
			entry.as_adjustment_entry ||
			reversedIds.has(entry.id)
		)
			continue;
		if (matchedIds.has(entry.id) && entry.payslip_id != null)
			refuse('An existing benefit payslip needs its saved case allocation before replanning.');
		if (
			!matchedIds.has(entry.id) &&
			(entry.charges ?? []).some((charge) => {
				const day = dateKey(charge.date);
				return day >= from && day <= through;
			})
		)
			refuse(
				'Every benefit leave charge in the case span needs the approved event identity and case allocation.'
			);
	}
	for (const slip of input.payslips) {
		if (slip.employment_id !== caseRow.employment_id || slip.paid_at == null) continue;
		const window = slip.salary_window;
		if (window == null)
			refuse('A prior paid payslip needs its salary window before benefit cash can be allocated.');
		if (dateKey(window.start) <= through && dateKey(window.end) >= from)
			refuse('Prior paid salary overlaps benefit leave without a saved case allocation.');
	}
	const assignedIds = new Set<string>();
	const entries = new Map(input.entries.map((row) => [row.id, row]));
	const cutoffs = input.cutoffs.map((cutoff) => {
		if (!(cutoff.premium_evidence_reference ?? '').trim() || cutoff.leave_entry_ids.length === 0)
			refuse('Each benefit cutoff needs premium evidence and approved leave entries.');
		const salaryFrom = dateKey(cutoff.salary.start);
		const salaryThrough = dateKey(cutoff.salary.end);
		if (!isCalendarDate(salaryFrom) || !isCalendarDate(salaryThrough) || salaryThrough < salaryFrom)
			refuse('A benefit cutoff needs an ordered salary window.');
		const covered = cutoff.leave_entry_ids
			.flatMap((id) => {
				if (!matchedIds.has(id) || assignedIds.has(id))
					refuse('Each approved benefit leave entry must belong to one cutoff.');
				assignedIds.add(id);
				return entries.get(id)?.charges?.map((charge) => dateKey(charge.date)) ?? [];
			})
			.toSorted();
		if (
			covered.length === 0 ||
			covered[0]! < salaryFrom ||
			covered.at(-1)! > salaryThrough ||
			covered.length !== daysBetween(covered[0]!, covered.at(-1)!).length ||
			daysBetween(covered[0]!, covered.at(-1)!).some((day, index) => day !== covered[index])
		)
			refuse('Benefit leave entries must cover exactly this cutoff’s consecutive salary days.');
		return {
			period: cutoff.period,
			from: covered[0]!,
			through: covered.at(-1)!,
			pay_on: cutoff.pay_on,
			employee_premiums: cutoff.employee_premiums
		};
	});
	if (assignedIds.size !== matchedIds.size)
		refuse('Every approved benefit leave entry must be assigned to a cutoff.');
	const paidKinds = new Set(employeePaymentKinds(type));
	const employeeCash = own
		.filter((row) => paidKinds.has(row.kind))
		.map((row) => ({ kind: row.kind, paid_on: row.paid_on, amount: row.amount }));
	if (employeeCash.some((row) => dateKey(row.paid_on) > dateKey(input.as_of)))
		refuse('Future-dated benefit cash cannot fund a current payroll plan.');
	const allocation = allocateBenefitPay({
		case_type: type,
		currency: input.currency,
		benefit_case: caseRow,
		evidence: input.evidence,
		leave_from: from,
		leave_through: through,
		monthly_salary: input.wage_basis.monthly_salary,
		actual_award: caseRow.award_amount,
		cutoffs,
		employee_cash: employeeCash
	});
	const dueOn = advanceDue(type, caseSite(type, caseRow, input.evidence));
	const firstPayday = dateKey(input.cutoffs[0]!.pay_on);
	const cashDeadline = dueOn !== '' && dueOn < firstPayday ? dueOn : firstPayday;
	const cashByDeadline = (component: string) =>
		Math.round(
			employeeCash
				.filter(
					(row) =>
						movementKind(type, row.kind).component === component &&
						dateKey(row.paid_on) <= cashDeadline
				)
				.reduce((total, row) => total + decodeNumber(row.amount), 0) * 100
		) / 100;
	if (
		cashByDeadline(type.components.award) < allocation.award ||
		cashByDeadline(type.components.differential) < allocation.employer_differential
	)
		refuse(
			'The full award advance and salary differential need actual employee payment evidence by the statutory deadline and before the first cutoff.'
		);
	if (
		Math.abs(
			decodeNumber(input.wage_basis.full_span_wage_period.normal_wages) - allocation.full_pay
		) > 0.001
	)
		refuse('Recorded full-span wages disagree with the monthly-salary full-pay formula.');
	return Object.freeze({
		case_id: caseRow.id,
		status: 'PROPOSED_NOT_SAVED' as const,
		cutoffs: Object.freeze(
			allocation.cutoffs.map((row, index) =>
				Object.freeze({
					...row,
					leave_entry_ids: Object.freeze([...input.cutoffs[index]!.leave_entry_ids]),
					monthly_salary_reference: input.wage_basis.monthly_salary_reference,
					full_span_wage_reference: input.wage_basis.full_span_wage_period.reference,
					premium_evidence_reference: input.cutoffs[index]!.premium_evidence_reference,
					basic_salary_share_by_year: Object.freeze(row.basic_salary_share_by_year)
				})
			)
		)
	});
}
