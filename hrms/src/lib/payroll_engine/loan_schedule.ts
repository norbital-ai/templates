import { BigDecimal, DateTime } from 'effect';

/**
 * A loan repayment schedule is a small state machine:
 * `NO_TERMS` (no positive principal or period) → `READY` (terms valid, nothing generated) →
 * `GENERATED` (open installments) → `SEALED` (a payroll run captured the loan or an installment).
 * Sealed installments are never rewritten; regeneration only fills the unpaid months around them.
 */
export type LoanScheduleRepayment = {
	readonly id?: string;
	readonly amount: number;
	readonly paid_on: string;
	readonly payroll_run_id?: string | null;
};

export type LoanScheduleInput = {
	readonly principal: number;
	readonly from: string;
	readonly to: string;
	readonly repayments: readonly LoanScheduleRepayment[];
};

export type LoanScheduleState = 'NO_TERMS' | 'READY' | 'GENERATED' | 'SEALED';

/**
 * What a replacement contract does with an outstanding loan. A same-jurisdiction replacement
 * carries it untouched; otherwise it transfers by catalogue code when the target has one, else
 * it settles from the old contract's final pay.
 */
export type LoanDisposition = 'CARRY' | 'SETTLE' | 'TRANSFER';

export const loanDisposition = (input: {
	readonly carry: boolean;
	readonly settle: boolean;
	readonly targetCatalog: boolean;
}): LoanDisposition =>
	input.carry ? 'CARRY' : input.settle || !input.targetCatalog ? 'SETTLE' : 'TRANSFER';

/** Monthly pay a contract rate implies; `null` when only a person can say (an unknown unit or missing hours). */
export const monthlyEquivalent = (terms: {
	readonly rate?: { readonly amount?: unknown; readonly unit?: unknown } | null | undefined;
	readonly normal_days_per_week?: number | null | undefined;
	readonly normal_hours_per_week?: number | null | undefined;
}): number | null => {
	const amount = Number(terms.rate?.amount ?? Number.NaN);
	if (!Number.isFinite(amount)) return null;
	const weekly = (units: number | null | undefined) =>
		units == null ? null : (amount * units * 52) / 12;
	return terms.rate?.unit === 'MONTHLY'
		? amount
		: terms.rate?.unit === 'DAILY'
			? weekly(terms.normal_days_per_week)
			: terms.rate?.unit === 'HOURLY'
				? weekly(terms.normal_hours_per_week)
				: null;
};

/** The reference of the repayment a leaver's final pay makes; a partial one adds ` (partial)`. */
export const FINAL_SETTLEMENT = 'Final settlement';

export type LoanRecovery = {
	/** The most final pay may repay: expected pay less the entity's floor share, in money. */
	readonly maximum: number;
	readonly proposed: number;
	readonly remaining: number;
	readonly allocations: readonly {
		readonly id: string;
		readonly final: number;
		readonly remaining: number;
	}[];
};

/**
 * The final-pay recovery of a leaver's loans: at most expected pay less `floorPercent`, in the currency's minor units.
 * Loans are repaid whole, in id order, until the cap runs out, so the allocation is deterministic and sums to the cap.
 */
export const loanRecovery = (input: {
	readonly loans: readonly { readonly id: string; readonly outstanding: number }[];
	readonly expectedPay: number;
	readonly floorPercent: number;
	readonly decimals: number;
}): LoanRecovery => {
	// to the currency's minor unit: an amount rounds half up, the cap rounds down
	const minor = { scale: input.decimals, mode: 'half-ceil' } as const;
	const maximum = BigDecimal.round(
		BigDecimal.divideUnsafe(
			BigDecimal.multiply(
				BigDecimal.max(
					BigDecimal.round(BigDecimal.fromNumberUnsafe(input.expectedPay), minor),
					BigDecimal.make(0n, 0)
				),
				BigDecimal.fromNumberUnsafe(100 - input.floorPercent)
			),
			BigDecimal.make(100n, 0)
		),
		{ scale: input.decimals, mode: 'floor' }
	);
	let left = maximum;
	const allocations = input.loans
		.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map(({ id, outstanding }) => {
			const owed = BigDecimal.round(BigDecimal.fromNumberUnsafe(outstanding), minor);
			const final = BigDecimal.min(owed, left);
			left = BigDecimal.subtract(left, final);
			return {
				id,
				final: BigDecimal.toNumberUnsafe(final),
				remaining: BigDecimal.toNumberUnsafe(BigDecimal.subtract(owed, final))
			};
		});
	const proposed = BigDecimal.subtract(maximum, left);
	return {
		maximum: BigDecimal.toNumberUnsafe(maximum),
		proposed: BigDecimal.toNumberUnsafe(proposed),
		remaining: BigDecimal.toNumberUnsafe(
			BigDecimal.subtract(
				BigDecimal.sumAll(
					input.loans.map((loan) =>
						BigDecimal.round(BigDecimal.fromNumberUnsafe(loan.outstanding), minor)
					)
				),
				proposed
			)
		),
		allocations
	};
};

export type LoanScheduleProblem =
	| 'principal'
	| 'period'
	| 'amount'
	| 'date'
	| 'outside'
	| 'duplicate'
	| 'total'
	| 'sealed_exceeds'
	| 'no_dates';

const month = (day: string) => day.slice(0, 7);
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day);
// a positive amount in whole cents
const validMoney = (value: number) =>
	Number.isFinite(value) && value > 0 && BigDecimal.fromNumberUnsafe(value).scale <= 2;

export const loanScheduleState = (input: LoanScheduleInput): LoanScheduleState => {
	if (
		!validMoney(input.principal) ||
		!validDay(input.from) ||
		!validDay(input.to) ||
		input.to < input.from
	)
		return 'NO_TERMS';
	if (input.repayments.some((row) => row.payroll_run_id != null)) return 'SEALED';
	return input.repayments.length > 0 ? 'GENERATED' : 'READY';
};

const termsProblems = (input: LoanScheduleInput): LoanScheduleProblem[] => {
	const problems: LoanScheduleProblem[] = [];
	if (!validMoney(input.principal)) problems.push('principal');
	if (!validDay(input.from) || !validDay(input.to) || input.to < input.from)
		problems.push('period');
	return problems;
};

/** Problems in the terms, or in manually edited installments. */
export const loanScheduleProblems = (input: LoanScheduleInput): readonly LoanScheduleProblem[] => {
	const problems = termsProblems(input);
	const seen = new Set<string>();
	for (const row of input.repayments) {
		if (!validMoney(row.amount)) problems.push('amount');
		if (!validDay(row.paid_on)) {
			problems.push('date');
			continue;
		}
		const key = month(row.paid_on);
		if (seen.has(key)) problems.push('duplicate');
		seen.add(key);
		if (problems.includes('period')) continue;
		if (key < month(input.from) || key > month(input.to)) problems.push('outside');
	}
	if (problems.length === 0) {
		const total = BigDecimal.sumAll(
			input.repayments.map((row) => BigDecimal.fromNumberUnsafe(row.amount))
		);
		const principal = BigDecimal.fromNumberUnsafe(input.principal);
		const sealed = input.repayments.some((row) => row.payroll_run_id != null);
		if (BigDecimal.isGreaterThan(total, principal) && sealed) problems.push('sealed_exceeds');
		else if (!BigDecimal.equals(total, principal)) problems.push('total');
	}
	return [...new Set(problems)];
};

/**
 * Build the next schedule. Sealed rows stay exactly as they are and are deducted from the principal;
 * every open row is replaced. Returns the rows to create and the open rows to delete.
 */
export const buildLoanSchedule = (
	input: LoanScheduleInput
): { readonly create: readonly LoanScheduleRepayment[]; readonly remove: readonly string[] } => {
	const problems = termsProblems(input);
	if (problems.length > 0) throw new Error(`Loan terms are invalid: ${problems.join(', ')}.`);
	const locked = input.repayments.filter((row) => row.payroll_run_id != null);
	const remaining = BigDecimal.subtract(
		BigDecimal.fromNumberUnsafe(input.principal),
		BigDecimal.sumAll(locked.map((row) => BigDecimal.fromNumberUnsafe(row.amount)))
	);
	if (BigDecimal.isNegative(remaining))
		throw new Error('Sealed repayments exceed the principal amount.');
	const taken = new Set(locked.map((row) => month(row.paid_on)));
	// monthly installments from the first month through the last, the remainder in the final months
	const first = DateTime.startOf(DateTime.makeUnsafe(input.from), 'month');
	const dates = Array.from({ length: 601 }, (_, index) =>
		DateTime.formatIsoDate(DateTime.add(first, { months: index }))
	).filter((day) => month(day) <= month(input.to) && !taken.has(month(day)));
	if (BigDecimal.isPositive(remaining) && dates.length === 0)
		throw new Error('The repayment period has no unpaid months.');
	if (BigDecimal.isZero(remaining))
		return {
			create: [],
			remove: input.repayments.flatMap((row) =>
				row.payroll_run_id == null && row.id != null ? [row.id] : []
			)
		};
	// whole cents each, the cents left over one each on the last months
	const base = BigDecimal.round(
		BigDecimal.divideUnsafe(remaining, BigDecimal.make(BigInt(dates.length), 0)),
		{ scale: 2, mode: 'floor' }
	);
	const extra = Number(
		BigDecimal.scale(
			BigDecimal.subtract(
				remaining,
				BigDecimal.multiply(base, BigDecimal.make(BigInt(dates.length), 0))
			),
			2
		).value
	);
	const create = dates.map((day, index) => ({
		amount: BigDecimal.toNumberUnsafe(
			index >= dates.length - extra ? BigDecimal.sum(base, BigDecimal.make(1n, 2)) : base
		),
		paid_on: day,
		payroll_run_id: null
	}));
	return {
		create,
		remove: input.repayments.flatMap((row) =>
			row.payroll_run_id == null && row.id != null ? [row.id] : []
		)
	};
};
