import { decodeNumber } from '@norbital-ai/std/json';
import { newLocalId } from './ids.js';
import { dateKey, PAYROLL_TIME_ZONE } from './iso-day.js';
import { startOfDayInstant } from './ui/calendar.js';

/**
 * One repayment line on the loan form. The matrix owns this draft; submit maps it onto the
 * nested `repayment_loan` graph. Amounts are never rewritten here. A new line starts empty
 * (`null`), which the schedule balance refuses before the write can.
 *
 * `sequence` is a stored key — `unique(loan_id, sequence)`, and the engine recovers repayments in
 * its order — but it is not an operator decision: it is the plan's date order, so the form never
 * shows it and every path out of this module renumbers it from the dates. Two schedules with the
 * same dates therefore carry the same sequence whatever order the lines were typed in.
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

/**
 * The plan in the order it is recovered: by due date, with `sequence` renumbered to match.
 *
 * Lines with no date yet sort last and keep the order they were added in, so a fresh empty row
 * stays at the bottom of the matrix while it is being filled rather than jumping on each keystroke.
 */
export function loanScheduleOrdered(
	rows: readonly LoanRepaymentDraft[]
): readonly LoanRepaymentDraft[] {
	return rows
		.map((row, index) => ({ row, index, key: dateKey(row.due_date) }))
		.toSorted((left, right) => {
			if (left.key === '') return right.key === '' ? left.index - right.index : 1;
			if (right.key === '') return -1;
			return left.key === right.key ? left.index - right.index : left.key < right.key ? -1 : 1;
		})
		.map(({ row }, position) =>
			row.sequence === position + 1 ? row : { ...row, sequence: position + 1 }
		);
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
	return [
		...loanScheduleOrdered(
			rows.map((row) => ({
				id: row.id,
				due_date: row.due_date,
				amount_due: row.amount_due,
				sequence: row.sequence
			}))
		)
	];
}

export function loanScheduleWriteRows(rows: readonly LoanRepaymentDraft[]): ReadonlyArray<{
	readonly id: string;
	readonly due_date?: string;
	readonly amount_due?: number;
	readonly sequence: number;
}> {
	return loanScheduleOrdered(rows).map((row) => ({
		id: row.id,
		...(row.due_date == null ? {} : { due_date: row.due_date }),
		...(row.amount_due == null ? {} : { amount_due: row.amount_due }),
		sequence: row.sequence
	}));
}

// ── generation ──────────────────────────────────────────────────────────────────────────────

/** The day `months` calendar months after `day`, clamped to the target month's last day. */
function shiftDayByMonths(day: string, months: number): string {
	const [year, month, date] = day.split('-').map(Number) as [number, number, number];
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	const lastOfMonth = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
	).getUTCDate();
	const clamped = Math.min(date, lastOfMonth);
	return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

/**
 * The instalment days a loan's effective period asks for: its start day, then the same day of each
 * following month, up to and including the last one inside the period.
 *
 * An open-ended period yields nothing. The number of instalments has to come from somewhere, and
 * a loan with no end date does not say how many — inventing a count would be inventing the
 * agreement.
 */
export function loanInstalmentDays(range: unknown): readonly string[] {
	if (range == null || typeof range !== 'object') return [];
	const from = dateKey(Reflect.get(range, 'start') as string | null | undefined);
	const to = dateKey(Reflect.get(range, 'end') as string | null | undefined);
	if (from === '' || to === '' || to < from) return [];
	const days: string[] = [];
	for (let month = 0; month < 600; month += 1) {
		const day = shiftDayByMonths(from, month);
		if (day > to) break;
		days.push(day);
	}
	return days;
}

/**
 * True when the "Generate schedule" action has something to do: the loan states a principal and a
 * closed effective period, and what is on the form does not add up to the principal.
 *
 * A balanced schedule is not regenerated. The operator's own amounts are an authored fact, and a
 * button that silently replaced them with equal instalments would destroy exactly the schedule
 * somebody sat down to type.
 */
export function canGenerateLoanSchedule(
	principal: unknown,
	range: unknown,
	rows: readonly { readonly amount_due: unknown }[]
): boolean {
	const stated = decodeNumber(principal);
	if (!Number.isFinite(stated) || stated <= 0) return false;
	if (loanInstalmentDays(range).length === 0) return false;
	return loanScheduleImbalanced(principal, rows);
}

/**
 * An equal-instalment schedule across the loan's effective period.
 *
 * Three things it deliberately does not do:
 *
 * - It does not mint new ids for lines that already exist. An unlocked line keeps its `id` and is
 *   re-dated and re-priced in place, so regenerating does not orphan a row the database already
 *   holds and the nested write updates rather than deletes-and-inserts.
 * - It does not touch a locked line. A repayment a payslip has captured is history; its date and
 *   amount stand, its month is skipped, and only the residual principal is spread over what is
 *   left. Regenerating a fully captured schedule is therefore a no-op, not a refusal.
 * - It does not produce fractions. Instalments are whole currency units and the last one carries
 *   the remainder, which is what the operator does by hand: 167 × 5 + 165 = 1000. Rounding is up,
 *   so the tail shrinks rather than grows — a loan is recovered slightly faster, never slower. On a
 *   principal too small to round up across the period (7 over 6 months) rounding up would leave the
 *   last instalment negative, so that case rounds down instead.
 */
export function generateLoanSchedule(input: {
	readonly principal: unknown;
	readonly range: unknown;
	readonly rows: readonly LoanRepaymentDraft[];
	readonly lockedIds: ReadonlySet<string>;
}): readonly LoanRepaymentDraft[] {
	const stated = decodeNumber(input.principal);
	const days = loanInstalmentDays(input.range);
	if (!Number.isFinite(stated) || stated <= 0 || days.length === 0) return input.rows;

	const ordered = loanScheduleOrdered(input.rows);
	const locked = ordered.filter((row) => input.lockedIds.has(row.id));
	const reusable = ordered.filter((row) => !input.lockedIds.has(row.id));
	const takenDays = new Set(locked.map((row) => dateKey(row.due_date)));
	const openDays = days.filter((day) => !takenDays.has(day));

	const residual = Math.max(0, stated - loanScheduleTotal(locked));
	if (openDays.length === 0 || residual === 0) return loanScheduleOrdered(locked);

	const roundedUp = Math.ceil(residual / openDays.length);
	const instalment =
		residual - roundedUp * (openDays.length - 1) < 0
			? Math.floor(residual / openDays.length)
			: roundedUp;
	const generated = openDays.map((day, index) => ({
		id: reusable[index]?.id ?? newLocalId(),
		due_date: startOfDayInstant(day, PAYROLL_TIME_ZONE),
		amount_due:
			index === openDays.length - 1 ? residual - instalment * (openDays.length - 1) : instalment,
		sequence: 0
	}));
	return loanScheduleOrdered([...locked, ...generated]);
}
