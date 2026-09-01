/**
 * Component entries and loan repayments — the two source families payroll consumes for money.
 *
 * An entry's `amount` is always a positive **magnitude**. Direction comes from the pay component's
 * policy and from the treatment grid; the one derived exception is a manual correction whose
 * operation is `REVERSAL`, which settles in the opposite bucket of the settled output it corrects.
 * The correction points at a real settled adjustment through `corrects_adjustment_id`, so there is
 * no reversal chain to walk and no sign to flip transitively — the removed `obligations` model
 * carried a `reverses` walk whose single-flip sign silently doubled a negative on a
 * reversal of a reversal. A chain cannot exist here: a correction names an output, and outputs are
 * immutable.
 *
 * Which run an entry settles in: the stored `pay_period` override wins; the cutoff supplies the
 * default from the claim's incurred date or the entry's own event date.
 */

import type { WorkspaceRow } from '../$types.js';
import type { ComponentEntryEvent } from '../../../datatypes/component_entry_event/+definition.js';
import { dateKey, type IsoDate } from './dates.js';
import { defaultPayPeriod } from './period.js';
import { decodeNumber } from '@norbital-ai/std/json';

export type ComponentEntry = WorkspaceRow<'component_entries'>;
export type Loan = WorkspaceRow<'loans'>;
export type LoanRepayment = WorkspaceRow<'loan_repayments'>;

/** The typed event payload of an entry, as the strict custom type declares it. */
export const entryEvent = (entry: ComponentEntry): ComponentEntryEvent | null => {
	const event: unknown = entry.event;
	if (event == null || typeof event !== 'object' || typeof Reflect.get(event, 'kind') !== 'string')
		return null;
	return event as ComponentEntryEvent;
};

/** The day an entry's economics belong to — a claim's incurred day, or the entry's own date. */
export function entryEventDate(entry: ComponentEntry): IsoDate | null {
	const event = entryEvent(entry);
	if (event?.kind === 'CLAIM') return dateKey(event.incurred_on);
	return dateKey(entry.event_date);
}

/** Which run an entry settles in. The stored `pay_period` wins; the cutoff supplies the default. */
export function entryPayPeriod(entry: ComponentEntry, cutoffDay: number): string {
	if (entry.pay_period != null && entry.pay_period !== '') return entry.pay_period;
	const event = entryEventDate(entry);
	if (event == null) throw new Error(`Component entry ${entry.id} has no event date to settle by.`);
	return defaultPayPeriod(event, cutoffDay);
}

/**
 * `+1` for an entry that pays or takes under its component's policy, `−1` for a reversal, which
 * undoes the settled output it corrects and therefore settles in the opposite bucket.
 */
export function entrySign(entry: ComponentEntry): number {
	const event = entryEvent(entry);
	return event?.kind === 'MANUAL_ADJUSTMENT' && event.operation === 'REVERSAL' ? -1 : 1;
}

/** A standing allowance's own effective range, which prorates it independently of the employment. */
export function recurringRange(entry: ComponentEntry): {
	readonly start: IsoDate;
	readonly end: IsoDate | null;
} | null {
	const event = entryEvent(entry);
	if (event?.kind !== 'ALLOWANCE') return null;
	const range = entry.effective_range;
	if (range == null) return null;
	return {
		start: String(range.start).slice(0, 10),
		end: range.end == null ? null : String(range.end).slice(0, 10)
	};
}

/**
 * Whether an entry prorates. Only a standing allowance does: a claim, a bonus, an arrears
 * settlement and a correction are each whole amounts for a moment in time, and dividing them by
 * the days of a month would be meaningless.
 */
export function prorates(entry: ComponentEntry): boolean {
	return entryEvent(entry)?.kind === 'ALLOWANCE';
}

/**
 * Whether drawing on this entry uses it up.
 *
 * A one-off claim, bonus, arrears settlement and correction are each bounded by their amount, so
 * what earlier paid runs took reduces what is left — and a one-off belongs to at most one
 * standing/paid payslip, which the gather step refuses by name. A reversal is signed rather than
 * depleted: netting a negative draw against a magnitude would grow it. A standing allowance is not
 * bounded by anything — it states an amount **per period** and pays it whole in every period its
 * range covers.
 */
export function depletes(entry: ComponentEntry): boolean {
	const event = entryEvent(entry);
	if (event == null) return true;
	if (event.kind === 'ALLOWANCE') return false;
	return !(event.kind === 'MANUAL_ADJUSTMENT' && event.operation === 'REVERSAL');
}

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
