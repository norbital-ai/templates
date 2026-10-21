import { addMonths, isPlainDate, monthOf, PlainDate, type DatePeriod } from '@norbital-ai/std/date';
import { Decimal, sum } from '@norbital-ai/std/decimal';

export type LoanRepayment = {
	readonly id?: string;
	readonly occurred_on: PlainDate;
	readonly amount: Decimal;
	readonly payslip_id?: string | null;
	readonly activity?: 'AWARD' | 'REVERSAL';
	readonly sequence?: number | null;
};

export type LoanScheduleInput = {
	readonly principal_amount: Decimal;
	readonly repayment_period: DatePeriod;
	readonly repayment_frequency?: 'MONTHLY' | 'SEMI_MONTHLY';
	readonly repayments?: readonly LoanRepayment[];
	/** The governing version's money: `payroll.minor_units`, else its currency's ISO scale. */
	readonly scale: number;
	/** The governing version's `payroll.semi_monthly_split`: a semi-monthly loan's first instalment day. */
	readonly semi_monthly_split: number;
};

type LoanScheduleResult =
	| { readonly ok: true; readonly repayments: readonly LoanRepayment[] }
	| { readonly ok: false; readonly message: string };

const validMoney = (amount: Decimal, scale: number): boolean =>
	amount.cmp(0) > 0 && amount.eq(amount.round(scale));
const signedAmount = (row: LoanRepayment): Decimal =>
	row.activity === 'REVERSAL' ? row.amount.neg() : row.amount;
const monthEnd = (date: PlainDate): PlainDate =>
	date.slice(0, 7) === '9999-12' ? PlainDate('9999-12-31') : monthOf(date).to!;

function invalidTerms(input: LoanScheduleInput): string | null {
	if (!validMoney(input.principal_amount, input.scale))
		return 'Principal must be positive and use whole minor units.';
	const { from, to } = input.repayment_period;
	if (!isPlainDate(from) || to == null || !isPlainDate(to) || to < from)
		return 'Repayment period must have valid start and end dates, with the end on or after the start.';
	return null;
}

/** Check manual repayment edits without changing their amounts, dates or paid history. */
export function validateLoanRepayments(input: LoanScheduleInput): LoanScheduleResult {
	const invalid = invalidTerms(input);
	if (invalid != null) return { ok: false, message: invalid };
	const repayments = input.repayments ?? [];
	const { from, to } = input.repayment_period;
	if (repayments.some((row) => !validMoney(row.amount, input.scale)))
		return {
			ok: false,
			message: 'Every repayment amount must be positive and use whole minor units.'
		};
	if (
		repayments.some(
			(row) => !isPlainDate(row.occurred_on) || row.occurred_on < from || row.occurred_on > to!
		)
	)
		return { ok: false, message: 'Every repayment must fall within the repayment period.' };
	if (!sum(repayments.map(signedAmount)).eq(input.principal_amount))
		return { ok: false, message: 'Repayments must total the principal amount after reversals.' };
	return { ok: true, repayments };
}

/** Keep paid rows intact and share the remaining principal as evenly as minor units allow across unpaid dates. */
export function buildLoanSchedule(input: LoanScheduleInput): LoanScheduleResult {
	const invalid = invalidTerms(input);
	if (invalid != null) return { ok: false, message: invalid };
	const { principal_amount, repayment_period, repayment_frequency = 'MONTHLY', scale } = input;
	const { from, to } = repayment_period;
	const existing = input.repayments ?? [];
	const locked = existing.filter((row) => row.payslip_id != null);
	if (locked.some((row) => !validMoney(row.amount, input.scale)))
		return {
			ok: false,
			message: 'Paid repayments must have positive amounts in whole minor units.'
		};
	if (
		locked.some(
			(row) => !isPlainDate(row.occurred_on) || row.occurred_on < from || row.occurred_on > to!
		)
	)
		return { ok: false, message: 'The repayment period cannot exclude a paid repayment.' };
	const remaining = principal_amount.minus(sum(locked.map(signedAmount)));
	if (remaining.cmp(0) < 0)
		return { ok: false, message: 'Paid repayments exceed the principal amount.' };
	if (remaining.isZero()) return { ok: true, repayments: locked };

	const dates = new Set(locked.map((row) => row.occurred_on));
	const unpaid: { readonly occurred_on: PlainDate; readonly existing?: LoanRepayment }[] = [];
	for (const row of existing) {
		if (
			row.payslip_id != null ||
			!isPlainDate(row.occurred_on) ||
			row.occurred_on < from ||
			row.occurred_on > to! ||
			dates.has(row.occurred_on)
		)
			continue;
		dates.add(row.occurred_on);
		unpaid.push({ occurred_on: row.occurred_on, existing: row });
	}
	if (unpaid.length === 0) {
		const anchoredToEnd = from === monthEnd(from);
		for (let index = 0; index <= 600; index++) {
			const month = addMonths(from, index);
			const candidates =
				repayment_frequency === 'MONTHLY'
					? [anchoredToEnd ? monthEnd(month) : month]
					: [
							PlainDate(
								`${month.slice(0, 7)}-${String(input.semi_monthly_split).padStart(2, '0')}`
							),
							monthEnd(month)
						];
			for (const occurred_on of candidates) {
				if (occurred_on < from || occurred_on > to! || dates.has(occurred_on)) continue;
				dates.add(occurred_on);
				unpaid.push({ occurred_on });
			}
			if (unpaid.length + locked.length > 600)
				return { ok: false, message: 'A loan schedule cannot exceed 600 repayments.' };
			if (monthEnd(month) >= to!) break;
		}
	}
	if (unpaid.length === 0)
		return { ok: false, message: 'The repayment period has no unpaid repayment dates.' };
	if (unpaid.length + locked.length > 600)
		return { ok: false, message: 'A loan schedule cannot exceed 600 repayments.' };
	const regular = remaining.div(unpaid.length, scale, 'down');
	if (regular.isZero())
		return {
			ok: false,
			message: 'Remaining principal must cover at least one minor unit per unpaid repayment.'
		};
	// One minor unit; the count is bounded by the number of unpaid dates, and amounts stay exact Decimals.
	const unit = Decimal.of(1).div(10 ** scale, scale);
	const extraUnits = remaining.minus(regular.times(unpaid.length)).div(unit, 0).toNumber();
	unpaid.sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
	const repayments = [
		...locked,
		...unpaid.map(({ occurred_on, existing: row }, index): LoanRepayment => {
			const { id, ...fields } = row ?? {};
			return {
				...fields,
				...(id != null && row?.activity !== 'REVERSAL' ? { id } : {}),
				occurred_on,
				amount: index >= unpaid.length - extraUnits ? regular.plus(unit) : regular,
				activity: 'AWARD'
			};
		})
	].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
	return { ok: true, repayments };
}
