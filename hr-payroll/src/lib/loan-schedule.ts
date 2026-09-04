import { decodeNumber } from '@norbital-ai/std/json';
import { newLocalId } from './ids.js';

/**
 * One repayment line on the loan form. The matrix owns this draft; submit maps it onto the
 * nested `repayment_loan` graph. Amounts are never rewritten here. A new line starts empty
 * (`null`), which the schedule balance refuses before the write can.
 */
export type LoanRepaymentDraft = {
	readonly id: string;
	readonly due_date: string | null;
	readonly amount_due: number | null;
	readonly sequence: number;
};

/** Same minor-unit slack `settlement_refusals` uses for recovered totals. */
const LOAN_SCHEDULE_TOLERANCE = 0.01;

export function loanScheduleTotal(rows: readonly { readonly amount_due: unknown }[]): number {
	return rows.reduce((total, row) => total + decodeNumber(row.amount_due), 0);
}

/** True when the draft schedule does not sum to the stated principal. Empty is unbalanced. */
export function loanScheduleImbalanced(
	principal: unknown,
	rows: readonly { readonly amount_due: unknown }[]
): boolean {
	const due = loanScheduleTotal(rows);
	const stated = decodeNumber(principal);
	if (!Number.isFinite(due) || !Number.isFinite(stated)) return true;
	return Math.abs(due - stated) > LOAN_SCHEDULE_TOLERANCE;
}

export function createLoanRepaymentDraft(previous?: LoanRepaymentDraft): LoanRepaymentDraft {
	return {
		id: newLocalId(),
		due_date: null,
		amount_due: null,
		sequence: (previous?.sequence ?? 0) + 1
	};
}

export function loanScheduleFromRows(
	rows: readonly {
		readonly id: string;
		readonly due_date: string;
		readonly amount_due: number;
		readonly sequence: number;
	}[]
): LoanRepaymentDraft[] {
	return rows.map((row) => ({
		id: row.id,
		due_date: row.due_date,
		amount_due: row.amount_due,
		sequence: row.sequence
	}));
}

export function loanScheduleWriteRows(rows: readonly LoanRepaymentDraft[]): ReadonlyArray<{
	readonly id: string;
	readonly due_date?: string;
	readonly amount_due?: number;
	readonly sequence: number;
}> {
	return rows.map((row) => ({
		id: row.id,
		...(row.due_date == null ? {} : { due_date: row.due_date }),
		...(row.amount_due == null ? {} : { amount_due: row.amount_due }),
		sequence: row.sequence
	}));
}
