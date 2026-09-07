/**
 * Pay requests and loan repayments — the two source families payroll consumes for money.
 *
 * ## One view over five collections
 *
 * A claim, a standing allowance, a bonus, an arrears settlement and a correction are five business
 * facts with five different authors, five sets of rules and five payslip meanings. They are five
 * collections for that reason. What they share is not the fact but the *arithmetic*: whichever one
 * a payslip consumes, the run needs the same five answers from it — which day its economics belong
 * to, which direction it settles in, whether it prorates, whether drawing on it uses it up, and
 * which window it is live across. Those answers used to be five `switch (event.kind)` statements
 * spread through this file and evaluated per call site.
 *
 * They are computed once here instead, at the boundary where the row is read, and the engine works
 * over a `PayRequest`. That is deliberately not a return to the union: the union was a *storage*
 * shape, so a claim could be written with no incurred date and a correction with no output to
 * correct. This is a *reading* shape, derived from five collections each of which already made
 * those illegal states unsayable.
 *
 * ## Direction
 *
 * `amount` is always a positive magnitude. Direction comes from the component's policy and from the
 * treatment grid; the one derived exception is a correction whose operation is `REVERSAL`, which
 * settles in the opposite bucket of the settled output it corrects. The correction points at a real
 * settled adjustment through `corrects_adjustment_id`, so there is no reversal chain to walk and no
 * sign to flip transitively — the removed `obligations` model carried a `reverses` walk whose
 * single flip silently doubled a negative on a reversal of a reversal. A chain cannot exist here: a
 * correction names an output, and outputs are immutable.
 *
 * Which run a request settles in: the stored `pay_period` override wins; the cutoff supplies the
 * default from the day the request's economics belong to.
 */

import type { WorkspaceRow } from '../$types.js';
import type { AllowanceRecurrence } from '../../../datatypes/allowance_recurrence/+definition.js';
import { requiredDateKey, type IsoDate } from './dates.js';
import { defaultPayPeriod, type PayCadence } from './period.js';
import { decodeNumber } from '@norbital-ai/std/json';

export type ClaimRequest = WorkspaceRow<'claim_requests'>;
export type AllowanceRequest = WorkspaceRow<'allowance_requests'>;
export type BonusRequest = WorkspaceRow<'bonus_requests'>;
export type ArrearsRequest = WorkspaceRow<'arrears_requests'>;
export type CorrectionRequest = WorkspaceRow<'correction_requests'>;
export type Loan = WorkspaceRow<'loans'>;
export type LoanRepayment = WorkspaceRow<'loan_repayments'>;

/** Which collection a request came from. The engine names it in refusals and in provenance. */
export const PAY_REQUEST_FAMILIES = [
	'CLAIM',
	'ALLOWANCE',
	'BONUS',
	'ARREARS',
	'CORRECTION'
] as const;
export type PayRequestFamily = (typeof PAY_REQUEST_FAMILIES)[number];

/** The `payslip_adjustments.input` arm each family's capture is recorded under. */
export const PAY_REQUEST_INPUT_KIND = {
	CLAIM: 'CLAIM_REQUEST_INPUT',
	ALLOWANCE: 'ALLOWANCE_REQUEST_INPUT',
	BONUS: 'BONUS_REQUEST_INPUT',
	ARREARS: 'ARREARS_REQUEST_INPUT',
	CORRECTION: 'CORRECTION_REQUEST_INPUT'
} as const satisfies Record<PayRequestFamily, string>;

/** The five arms of `payslip_adjustments.input` that name a pay request, for a read that wants them all. */
export const REQUEST_INPUT_KINDS = [
	'CLAIM_REQUEST_INPUT',
	'ALLOWANCE_REQUEST_INPUT',
	'BONUS_REQUEST_INPUT',
	'ARREARS_REQUEST_INPUT',
	'CORRECTION_REQUEST_INPUT'
] as const;

/** The window a standing allowance is live across; `end` null is open-ended. */
export type RequestWindow = { readonly start: IsoDate; readonly end: IsoDate | null };

/**
 * One pay request as the run reads it. Every derived answer is settled by the builder that made it,
 * so nothing downstream re-derives economics from storage shape.
 */
export type PayRequest = {
	readonly id: string;
	readonly family: PayRequestFamily;
	readonly employment_id: string;
	readonly component_catalogue_id: string;
	/** A positive magnitude, exactly as stored. */
	readonly amount: unknown;
	readonly approval_id: string | null;
	readonly pay_period: string | null;
	/** The day this request's economics belong to. */
	readonly event_date: IsoDate;
	/** `+1`, or `−1` for a reversal, which undoes the settled output it corrects. */
	readonly sign: number;
	/** A standing allowance's own window, which prorates it independently of the employment. */
	readonly window: RequestWindow | null;
	/** Whether a part-month reduces it. Only a standing allowance is measured per day of the month. */
	readonly prorates: boolean;
	/** Whether drawing on it uses it up. */
	readonly depletes: boolean;
	/** The settled output a correction fixes; null on every other family. */
	readonly corrects_adjustment_id: string | null;
	/** How a correction settles; null on every other family. */
	readonly operation: 'CORRECTION' | 'REVERSAL' | null;
	/** The periods an arrears settlement makes good; null on every other family. */
	readonly covers_periods: readonly string[] | null;
};

const magnitudeBase = (
	row: {
		readonly id: string;
		readonly employment_id: string;
		readonly component_catalogue_id: string;
		readonly amount: unknown;
		readonly approval_id?: string | null;
		readonly pay_period?: string | null;
	},
	family: PayRequestFamily,
	eventDate: IsoDate
) => ({
	id: row.id,
	family,
	employment_id: row.employment_id,
	component_catalogue_id: row.component_catalogue_id,
	amount: row.amount,
	approval_id: row.approval_id ?? null,
	pay_period: row.pay_period ?? null,
	event_date: eventDate,
	sign: 1,
	window: null,
	prorates: false,
	/**
	 * Everything except a recurring allowance is bounded by its amount, so what earlier paid runs
	 * took reduces what is left — and it belongs to at most one standing/paid payslip, which its
	 * capture junction's unique index now states outright.
	 */
	depletes: true,
	corrects_adjustment_id: null,
	operation: null,
	covers_periods: null
});

/** A claim's economics belong to the day the expense was incurred, not the day it was entered. */
export const claimRequest = (row: ClaimRequest): PayRequest =>
	magnitudeBase(row, 'CLAIM', requiredDateKey(row.incurred_on, 'claim incurred date'));

/**
 * A standing allowance, whose window is read off its recurrence and never off a column beside it.
 *
 * A one-off's window is its period's own month, so proration still measures it against the days
 * actually employed — what a one-off no longer does is masquerade as a recurring allowance whose
 * range happens to be one month long. A **recurring** allowance is bounded by nothing: it states an
 * amount **per period** and pays it whole in every period its window covers, so it never depletes
 * and its junction is the one with no unique on its source.
 */
export const allowanceRequest = (row: AllowanceRequest): PayRequest => {
	const recurrence = row.recurrence as AllowanceRecurrence;
	const window: RequestWindow =
		recurrence.kind === 'ONE_OFF'
			? {
					start: requiredDateKey(`${recurrence.period}-01`, 'allowance period'),
					end: requiredDateKey(monthEndDay(recurrence.period), 'allowance period end')
				}
			: {
					start: requiredDateKey(recurrence.from, 'allowance start'),
					end: recurrence.to == null ? null : requiredDateKey(recurrence.to, 'allowance end')
				};
	return {
		...magnitudeBase(row, 'ALLOWANCE', window.start),
		window,
		prorates: true,
		depletes: recurrence.kind === 'ONE_OFF'
	};
};

export const bonusRequest = (row: BonusRequest): PayRequest =>
	magnitudeBase(row, 'BONUS', requiredDateKey(row.awarded_on, 'bonus award date'));

export const arrearsRequest = (row: ArrearsRequest): PayRequest => ({
	...magnitudeBase(row, 'ARREARS', requiredDateKey(row.settled_on, 'arrears settlement date')),
	covers_periods: (row.covers_periods ?? []) as readonly string[]
});

/**
 * A correction. A reversal is **signed** rather than depleted: netting a negative draw against a
 * magnitude would grow it.
 */
export const correctionRequest = (row: CorrectionRequest): PayRequest => {
	const reversal = row.operation === 'REVERSAL';
	return {
		...magnitudeBase(row, 'CORRECTION', requiredDateKey(row.corrected_on, 'correction date')),
		sign: reversal ? -1 : 1,
		depletes: !reversal,
		corrects_adjustment_id: row.corrects_adjustment_id,
		operation: row.operation as 'CORRECTION' | 'REVERSAL'
	};
};

/**
 * Which run a request settles in. The stored `pay_period` wins; the cutoff supplies the default, in
 * the grammar of the cadence the employment is paid on.
 */
export function requestPayPeriod(
	request: PayRequest,
	cutoffDay: number,
	cadence?: PayCadence
): string {
	if (request.pay_period != null && request.pay_period !== '') return request.pay_period;
	return defaultPayPeriod(request.event_date, cutoffDay, cadence);
}

/** The last calendar day of a `YYYY-MM` period. */
const monthEndDay = (period: string): string => {
	const [year, month] = period.split('-').map(Number) as [number, number];
	return `${period}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
};

/**
 * What is still owed on a repayment, after what earlier PAID runs actually took.
 *
 * There is no carried-forward shortfall anywhere in this engine: a deduction the negative-net guard
 * could not take stays outstanding on the repayment, and the next run re-derives the remainder from
 * this same subtraction.
 */
export function repaymentOutstanding(repayment: LoanRepayment, consumed: number): number {
	const due = decodeNumber(repayment.amount_due);
	const taken = Math.min(Math.max(consumed, 0), due);
	return Math.max(0, due - taken);
}
