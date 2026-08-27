/**
 * Obligations — the only door money enters payroll through.
 *
 * An obligation's `amount` is always a **magnitude**. Direction comes from the pay component's
 * policy and from the treatment grid, and taking money back is an obligation whose `terms` is
 * `REVERSAL`, never a negative number. That is what keeps "is this figure a credit or a debit?"
 * answerable from the type alone.
 *
 * ## The arm is columns, so this file reads columns
 *
 * `terms` and `occasion` are real enum columns and every arm's payload is a real column beside
 * them. There is no union in jsonb to decode and no `terms->'occasion'->>'of'` path to walk — a
 * previous draft had one and it was deleted, because a field grant cannot mask a jsonb sub-path and
 * the database cannot enforce a foreign key that lives inside a blob. The complete arm/payload rule
 * is `obligationTermsIssues` in `src/lib/obligation_refusals.ts`; nothing here restates it.
 *
 * ## The reversal-sign bug this fixes
 *
 * The engine of record computes the sign as a single flip — `reverses_obligation_id ? -1 : 1`. That
 * is not transitive: reversing a reversal yields −1 again, so instead of restoring the original it
 * **doubles the negative**, silently. Nobody has done it yet, which is the only reason it has never
 * cost anyone money.
 *
 * Here the chain is walked to its root and the sign is `(−1)^depth`, so a reversal of a reversal
 * restores the original exactly. The walk is bounded and detects a cycle, because an obligation
 * that reverses itself would otherwise hang a payroll run (decision L41 / risk register #12).
 */

import type { WorkspaceRow } from '../$types.js';
import { dateKey, type IsoDate } from './dates.js';
import { defaultPayPeriod } from './period.js';

export type Obligation = WorkspaceRow<'obligations'>;

const MAX_REVERSAL_DEPTH = 32;

/**
 * `+1` for an obligation that pays, `−1` for one that takes back, `+1` again for a reversal of a
 * reversal.
 */
export function obligationSign(
	obligation: Obligation,
	byId: ReadonlyMap<string, Obligation>
): number {
	let current = obligation;
	let depth = 0;
	const seen = new Set<string>([obligation.id]);
	while (current.terms === 'REVERSAL') {
		depth += 1;
		if (depth > MAX_REVERSAL_DEPTH)
			throw new Error(
				`Obligation ${obligation.id} sits on a reversal chain more than ` +
					`${MAX_REVERSAL_DEPTH} deep. That is a data fault, not a correction.`
			);
		const reversed = current.reverses_obligation_id;
		if (reversed == null)
			throw new Error(
				`Obligation ${current.id} is a reversal that names no obligation to reverse.`
			);
		const target = byId.get(reversed);
		if (!target)
			throw new Error(
				`Obligation ${current.id} reverses ${reversed}, which is not in this run. ` +
					'A reversal must name an obligation payroll can see.'
			);
		if (seen.has(target.id))
			throw new Error(
				`Obligations ${[...seen].join(', ')} form a reversal cycle and cannot be signed.`
			);
		seen.add(target.id);
		current = target;
	}
	return depth % 2 === 0 ? 1 : -1;
}

/**
 * The obligation the sign chain ultimately points at.
 *
 * A reversal inherits its subject's economics — a cancelled December claim consumes December's cap,
 * not January's — so cap membership and the event date follow the root, while run membership
 * follows the reversal's own `pay_period` (decision L16 / L20).
 */
function rootObligation(
	obligation: Obligation,
	byId: ReadonlyMap<string, Obligation>
): Obligation {
	let current = obligation;
	let depth = 0;
	while (current.terms === 'REVERSAL' && depth < MAX_REVERSAL_DEPTH) {
		const reversed = current.reverses_obligation_id;
		if (reversed == null) return current;
		const target = byId.get(reversed);
		if (!target) return current;
		current = target;
		depth += 1;
	}
	return current;
}

function claimIncurredOn(obligation: Obligation): IsoDate | null {
	if (obligation.occasion !== 'CLAIM') return null;
	return dateKey(obligation.incurred_on);
}

/** Which run an obligation settles in. The stored `pay_period` wins; the cutoff supplies the default. */
export function obligationPayPeriod(obligation: Obligation, cutoffDay: number): string {
	if (obligation.pay_period != null && obligation.pay_period !== '') return obligation.pay_period;
	const incurred = claimIncurredOn(obligation);
	if (incurred != null) return defaultPayPeriod(incurred, cutoffDay);
	const eventDate = dateKey(obligation.event_date);
	if (eventDate == null) throw new Error(`Obligation ${obligation.id} has no event date to settle by.`);
	return defaultPayPeriod(eventDate, cutoffDay);
}

/** The date an obligation's economics belong to — its own, or its subject's when it is a reversal. */
export function obligationEventDate(
	obligation: Obligation,
	byId: ReadonlyMap<string, Obligation>
): IsoDate {
	const root = rootObligation(obligation, byId);
	const incurred = claimIncurredOn(root);
	if (incurred != null) return incurred;
	const date = dateKey(root.event_date);
	if (date == null) throw new Error(`Obligation ${root.id} has no event date.`);
	return date;
}

/** A standing obligation's own effective range, which prorates it independently of the employment. */
export function recurringRange(
	obligation: Obligation
): { readonly start: IsoDate; readonly end: IsoDate | null } | null {
	if (obligation.terms !== 'RECURRING') return null;
	const range = obligation.effective_range;
	if (range == null) return null;
	return {
		start: String(range.start).slice(0, 10),
		end: range.end == null ? null : String(range.end).slice(0, 10)
	};
}

/**
 * Whether an obligation prorates.
 *
 * Only a standing one does. A claim, a bonus, an instalment and an arrears payment are each whole
 * amounts for a moment in time, and dividing them by the days of a month would be meaningless.
 */
export function prorates(obligation: Obligation): boolean {
	return obligation.terms === 'RECURRING';
}

/**
 * Whether drawing on this obligation uses it up.
 *
 * **The arm decides, and it is the whole of the rule.** A `ONE_OFF` is one amount that is paid or
 * recovered once; a `SCHEDULED` obligation is a principal recovered by a dated plan. Both are
 * bounded by `amount`, so what earlier paid runs took reduces what is left — that arithmetic is
 * what replaced `SINGLE_USE: unique(component_entry_id)` when partial consumption made a database
 * ceiling impossible (`src/lib/settlement_refusals.ts`).
 *
 * A `RECURRING` obligation is not bounded by anything: it states an amount **per period** and pays
 * that amount whole in every period its range covers, so summing what earlier runs took and
 * subtracting it would stop a standing allowance after its first month. A `REVERSAL` is the
 * evidence that an earlier obligation was undone and settles once on its own period; it is signed
 * rather than depleted, and netting a negative draw against a magnitude would grow it.
 */
export function depletes(obligation: Obligation): boolean {
	return obligation.terms === 'ONE_OFF' || obligation.terms === 'SCHEDULED';
}
