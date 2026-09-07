import { decodeNumber } from '@norbital-ai/std/json';
import { inForceOnDay } from './effective_range.js';
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

/**
 * Same minor-unit slack `overConsumesEntry` in `settlement_refusals.ts` uses, for the same reason:
 * amounts are rounded to the currency's minor unit, so a schedule generated as whole units and
 * then edited a hundredth at a time can land one cent either side of the principal. One cent of
 * rounding is not an imbalance; a cent more than that is. Exactly the tolerance is accepted —
 * the comparison is `>`, as it is there.
 */
const LOAN_SCHEDULE_TOLERANCE = 0.01;

export function loanScheduleTotal(rows: readonly { readonly amount_due?: unknown }[]): number {
	return rows.reduce((total, row) => total + decodeNumber(row.amount_due), 0);
}

/** The three things a repayment schedule states, named so a caller can mark each one. */
export const SCHEDULE_IMBALANCED = 'SCHEDULE_IMBALANCED' as const;
export const SCHEDULE_OUT_OF_ORDER = 'SCHEDULE_OUT_OF_ORDER' as const;
export const SCHEDULE_OUTSIDE_EFFECTIVE_RANGE = 'SCHEDULE_OUTSIDE_EFFECTIVE_RANGE' as const;

type LoanScheduleRefusal = {
	readonly code:
		| typeof SCHEDULE_IMBALANCED
		| typeof SCHEDULE_OUT_OF_ORDER
		| typeof SCHEDULE_OUTSIDE_EFFECTIVE_RANGE;
	readonly message: string;
};

/** One repayment as the invariants see it: an amount, a day, and the position that orders them. */
type LoanScheduleRow = {
	readonly due_date?: unknown;
	readonly amount_due?: unknown;
	readonly sequence?: unknown;
};

/**
 * Everything wrong with a repayment schedule, in one pass — the one statement of what a loan's
 * plan has to be, shared by the loans form and the `loan_repayments` write hook.
 *
 * Three invariants, and they are the schedule's whole contract:
 *
 * 1. **The amounts sum to the principal**, to the cent (`LOAN_SCHEDULE_TOLERANCE`).
 * 2. **`due_date` strictly increases along `sequence`.** Strictly: two instalments on one day are
 *    one instalment, and `sequence` would be deciding which of them the engine recovers first.
 * 3. **The last repayment falls inside `effective_range`** — an agreement does not collect after
 *    it has ended. Judged with `inForceOnDay`, the day-head comparison the rest of this workspace
 *    reads a stored range with, so a repayment dated ON the period's end day is inside it. That is
 *    the same boundary `loanInstalmentDays` generates against (`if (day > to) break`), and the two
 *    disagreeing would mean the generator produced a schedule its own rules refuse.
 *
 * Every issue is returned, never just the first: a form marks all of them at once, and a write
 * refusal that names one problem at a time is a write refusal an importer meets three times.
 *
 * `principal` and `effectiveRange` are each judged only when stated. A caller that does not know
 * one of them — the loans form before a principal is typed, a hook that cannot see the agreement —
 * gets the invariants it *can* be told about rather than a refusal about a fact nobody supplied.
 */
export function loanScheduleRefusals(input: {
	readonly principal?: unknown;
	readonly effectiveRange?: unknown;
	readonly rows: readonly LoanScheduleRow[];
}): readonly LoanScheduleRefusal[] {
	const refusals: LoanScheduleRefusal[] = [];
	const rows = [...input.rows].sort(
		(left, right) => decodeNumber(left.sequence ?? 0) - decodeNumber(right.sequence ?? 0)
	);

	if (input.principal != null) {
		const due = loanScheduleTotal(rows);
		const stated = decodeNumber(input.principal);
		if (
			!Number.isFinite(due) ||
			!Number.isFinite(stated) ||
			Math.abs(due - stated) > LOAN_SCHEDULE_TOLERANCE
		)
			refusals.push({
				code: SCHEDULE_IMBALANCED,
				message:
					`${SCHEDULE_IMBALANCED}: the repayments add up to ${due.toFixed(2)}, and the loan's ` +
					`principal is ${stated.toFixed(2)}. A schedule recovers the agreement exactly.`
			});
	}

	// The days in sequence order, so both remaining checks read one list: the order rule walks it,
	// and the period rule asks its last entry. A row with no day yet — a fresh form line — is out of
	// both, and is already an imbalance.
	const days = rows.flatMap((row) => {
		const day = dateKey(row.due_date as string | null | undefined);
		return day === '' ? [] : [{ day, sequence: decodeNumber(row.sequence ?? 0) }];
	});

	const backwards = days.find((entry, index) => index > 0 && entry.day <= days[index - 1]!.day);
	if (backwards !== undefined)
		refusals.push({
			code: SCHEDULE_OUT_OF_ORDER,
			message:
				`${SCHEDULE_OUT_OF_ORDER}: repayment ${backwards.sequence} comes due ${backwards.day}, ` +
				`on or before the one before it. A schedule's due dates strictly increase along its ` +
				'sequence.'
		});

	const last = days.at(-1);
	if (input.effectiveRange != null && last !== undefined) {
		const range = input.effectiveRange as {
			readonly start?: string | null;
			readonly end?: string | null;
		};
		if (!inForceOnDay(range, last.day))
			refusals.push({
				code: SCHEDULE_OUTSIDE_EFFECTIVE_RANGE,
				message:
					`${SCHEDULE_OUTSIDE_EFFECTIVE_RANGE}: the last repayment comes due ${last.day}, ` +
					`outside the agreement's effective period (${dateKey(range.start) || '—'} to ` +
					`${dateKey(range.end) || '∞'}). An agreement does not collect after it has ended.`
			});
	}

	return refusals;
}

/** True when the draft schedule does not sum to the stated principal. Empty is unbalanced. */
export function loanScheduleImbalanced(
	principal: unknown,
	rows: readonly { readonly amount_due?: unknown }[]
): boolean {
	return loanScheduleRefusals({ principal: principal ?? Number.NaN, rows }).some(
		(refusal) => refusal.code === SCHEDULE_IMBALANCED
	);
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
	rows: readonly { readonly amount_due?: unknown }[]
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

// ── recovery ────────────────────────────────────────────────────────────────────────────────

type RepaymentProgress = {
	readonly recoveredAmount: number;
	readonly outstandingAmount: number;
	readonly paidRepayments: number;
	readonly totalRepayments: number;
	readonly settled: boolean;
};

/**
 * How far a schedule has been recovered, from the plan and what paid runs took.
 *
 * `paidRepayments` is DERIVED, not counted: repayments are recovered in the order they are
 * scheduled, so the number settled is the number of leading repayments the recovered total covers.
 * That is the same arithmetic `repaymentOutstanding` in `payroll_runs/lib/entries.ts` makes one
 * repayment at a time — `due - taken`, floored at zero — read across the whole plan. The two agree
 * because the engine's own ceiling (`overRecoversRepayment`) keeps recovery inside each repayment's
 * amount due, so a running total can never overshoot a row and land the count short.
 *
 * `rows` must be in recovery order; every caller reads them ordered by `due_date`, which is the
 * order `sequence` states.
 *
 * The tolerance mirrors `overRecoversRepayment` in `src/lib/settlement_refusals.ts`: amounts are
 * rounded to the currency's minor unit on the way into a payslip, so a schedule that sums to its
 * principal exactly can land a hundredth either side of it across a dozen runs.
 */
export function repaymentProgress(
	repayments: readonly { readonly amount_due?: unknown }[],
	recoveredAmount: number
): RepaymentProgress | null {
	const principal = loanScheduleTotal(repayments);
	if (!Number.isFinite(principal) || principal < 0) return null;
	const outstandingAmount = Math.max(0, principal - recoveredAmount);
	let covered = 0;
	let paidRepayments = 0;
	for (const repayment of repayments) {
		covered += decodeNumber(repayment.amount_due);
		if (covered - recoveredAmount > LOAN_SCHEDULE_TOLERANCE) break;
		paidRepayments += 1;
	}
	return {
		recoveredAmount,
		outstandingAmount,
		paidRepayments,
		totalRepayments: repayments.length,
		settled: outstandingAmount <= LOAN_SCHEDULE_TOLERANCE
	};
}
