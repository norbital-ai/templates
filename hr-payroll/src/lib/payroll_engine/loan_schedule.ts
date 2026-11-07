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
	const minor = 10 ** input.decimals;
	const units = (value: number) => Math.round(value * minor);
	const maximum = Math.floor(
		(Math.max(0, units(input.expectedPay)) * (100 - input.floorPercent)) / 100
	);
	let left = maximum;
	const allocations = input.loans
		.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
		.map(({ id, outstanding }) => {
			const owed = units(outstanding);
			const final = Math.min(owed, left);
			left -= final;
			return { id, final: final / minor, remaining: (owed - final) / minor };
		});
	return {
		maximum: maximum / minor,
		proposed: (maximum - left) / minor,
		remaining:
			(input.loans.reduce((total, loan) => total + units(loan.outstanding), 0) - (maximum - left)) /
			minor,
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
const validMoney = (value: number) =>
	Number.isFinite(value) && value > 0 && Math.round(value * 100) === value * 100;

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
		const total = input.repayments.reduce((sum, row) => sum + row.amount, 0);
		const sealed = input.repayments.some((row) => row.payroll_run_id != null);
		if (Math.round(total * 100) > Math.round(input.principal * 100) && sealed)
			problems.push('sealed_exceeds');
		else if (Math.round(total * 100) !== Math.round(input.principal * 100)) problems.push('total');
	}
	return [...new Set(problems)];
};

/** Monthly installments from the first month through the last, the remainder in the final months. */
const monthsBetween = (from: string, to: string): string[] => {
	const start = new Date(`${month(from)}-01T00:00:00Z`);
	const end = `${month(to)}-01`;
	const dates: string[] = [];
	for (let index = 0; index <= 600; index++) {
		const at = new Date(start);
		at.setUTCMonth(at.getUTCMonth() + index);
		const key = at.toISOString().slice(0, 10);
		if (key > end) break;
		dates.push(key);
		if (key === end) break;
	}
	return dates;
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
	const lockedTotal = locked.reduce((sum, row) => sum + row.amount, 0);
	if (Math.round(lockedTotal * 100) > Math.round(input.principal * 100))
		throw new Error('Sealed repayments exceed the principal amount.');
	const remaining = Math.round((input.principal - lockedTotal) * 100);
	const taken = new Set(locked.map((row) => month(row.paid_on)));
	const dates = monthsBetween(input.from, input.to).filter((day) => !taken.has(month(day)));
	if (remaining > 0 && dates.length === 0)
		throw new Error('The repayment period has no unpaid months.');
	if (remaining === 0)
		return {
			create: [],
			remove: input.repayments.flatMap((row) =>
				row.payroll_run_id == null && row.id != null ? [row.id] : []
			)
		};
	const base = Math.floor(remaining / dates.length);
	const extra = remaining - base * dates.length;
	const create = dates.map((day, index) => ({
		amount: (base + (index >= dates.length - extra ? 1 : 0)) / 100,
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
