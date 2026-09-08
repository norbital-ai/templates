/**
 * A claimable component's entitlement ceiling, and what a candidate entry has left of it.
 *
 * The cap is stated once, on the catalogue row (`component_definition`'s `cap`), and two callers
 * need the same answer at two different moments:
 *
 *   MEASURE   prices an entry and refuses the run when a `BLOCK` cap is exceeded.
 *   THE HOOK  refuses the entry when it is written, which is where a person can still fix it.
 *
 * Before this module the rule existed only in the first of those, so a twelfth claim against an
 * annual limit of ten was accepted, sat in the workspace, and took down the whole company's
 * payroll run weeks later — a refusal aimed at somebody who was not the person who made the
 * mistake, at a moment when it could no longer be corrected cheaply.
 *
 * ## Why the award evaluator is injected rather than imported
 *
 * A layer's ceiling is either a `FIXED` amount or a `FORMULA` over the payslip context — component
 * amounts measured this period, statutory facts, leave balances. At MEASURE time all of that
 * exists. At write time none of it does, and there is no honest way to invent it. So the caller
 * supplies the evaluator, and one that cannot answer says so by returning `null`; a cap with an
 * unresolvable applicable layer yields no ceiling and the write is left to the run, which is the
 * only place the number is knowable. That boundary is a property of the data, not a shortcut: a
 * cap whose ceiling depends on the payslip cannot be checked before the payslip exists.
 */

import type { ComponentDefinition } from '../../../datatypes/component_definition/+definition.js';
import { coversDate } from './effective.js';
import { monthBounds, periodHalf, periodMonth, requiredDateKey } from './dates.js';
import { isEligible, type PersonContext } from './eligibility.js';

/** Recurring awards belong to the paid instalment, rather than the standing source's start date. */
export const capOccurrenceDate = (period: string) =>
	periodHalf(period) === 1
		? requiredDateKey(`${periodMonth(period)}-15`, 'cap occurrence date')
		: monthBounds(periodMonth(period)).end;

type EntryCap = NonNullable<Extract<ComponentDefinition, { source: 'ENTRY' }>['cap']>;
type CapLayer = EntryCap['matrix']['layers'][number];

/** The entry columns this rule reads, so a hook may pass a candidate the database has never seen. */
type CapEntryLike = {
	readonly id: string;
	readonly employment_id: string;
};

type ResolvedEntryCap = {
	/** The ceiling in force for this person on this day: the highest applicable layer. */
	readonly amount: number;
	/** The reimbursable share, which is what actually counts against the ceiling. */
	readonly percentage: number;
	/** What earlier entries in the same capped period have already used of it. */
	readonly exceededBy: number;
};

type ResolveEntryCapOptions<TEntry extends CapEntryLike> = {
	readonly cap: EntryCap;
	readonly component: { readonly family: string; readonly code: string };
	readonly employmentId: string;
	readonly entry: CapEntryLike;
	readonly eventDate: string;
	/** Sibling entries of the same employment, this one included or not — it is excluded by id. */
	readonly siblings: readonly TEntry[];
	readonly eventDateOf: (entry: TEntry) => string | null;
	readonly componentOf: (entry: TEntry) => { readonly family: string; readonly code: string };
	/** Signed usage already valued under this source's own rules or captured output. */
	readonly usedAmountOf: (entry: TEntry) => number;
	readonly subject: PersonContext;
	/** The layer's ceiling, or `null` where this caller cannot know it. */
	readonly evaluateAward: (layer: CapLayer) => number | null;
};

/** Historical reimbursement is valued on its source date, independently of the next entry's cap. */
export function entryReimbursementPercentage(options: {
	readonly cap: EntryCap | null | undefined;
	readonly employmentId: string;
	readonly eventDate: string;
	readonly subject: PersonContext;
}): number {
	const layers = applicableCapLayers(options);
	return layers.length === 0
		? 100
		: Math.max(...layers.map((layer) => layer.reimbursement_percentage));
}

function applicableCapLayers(options: {
	readonly cap: EntryCap | null | undefined;
	readonly employmentId: string;
	readonly eventDate: string;
	readonly subject: PersonContext;
}): readonly CapLayer[] {
	return (options.cap?.matrix.layers ?? []).filter(
		(layer) =>
			(layer.level !== 'EMPLOYEE' || layer.employment_id === options.employmentId) &&
			coversDate(layer.effective_range, options.eventDate) &&
			isEligible(layer.eligibility, options.subject)
	);
}

/**
 * The ceiling that governs, and what is already spent against it.
 *
 * `null` means no ceiling this caller can state: either no layer applies to this person on this
 * day, or one that does is priced by a formula the caller cannot evaluate.
 */
export function resolveEntryCap<TEntry extends CapEntryLike>(
	options: ResolveEntryCapOptions<TEntry>
): ResolvedEntryCap | null {
	const applicable: { amount: number; percentage: number }[] = [];
	for (const layer of applicableCapLayers(options)) {
		const amount = options.evaluateAward(layer);
		// An applicable layer nobody can price makes the whole ceiling unknowable: the merge takes
		// the highest layer, so omitting one would understate the ceiling and refuse a legal entry.
		if (amount === null) return null;
		applicable.push({ amount, percentage: layer.reimbursement_percentage });
	}
	if (applicable.length === 0) return null;
	const amount = Math.max(...applicable.map((layer) => layer.amount));
	const percentage = Math.max(...applicable.map((layer) => layer.percentage));

	const samePeriod = (candidateDate: string): boolean => {
		switch (options.cap.period) {
			case 'PER_EVENT':
				return false;
			case 'LIFETIME':
				return true;
			case 'MONTH':
				return candidateDate.slice(0, 7) === options.eventDate.slice(0, 7);
			case 'CALENDAR_YEAR':
				return candidateDate.slice(0, 4) === options.eventDate.slice(0, 4);
		}
	};

	// Only what came *before* this entry counts against it, so two entries never each refuse the
	// other; ties break on id so the order is total and the same on every run.
	const previouslyUsed = options.siblings.reduce((total, candidate) => {
		if (
			candidate.employment_id !== options.employmentId ||
			options.componentOf(candidate).family !== options.component.family ||
			options.componentOf(candidate).code !== options.component.code ||
			candidate.id === options.entry.id
		)
			return total;
		const candidateDate = options.eventDateOf(candidate);
		if (candidateDate == null) return total;
		if (
			!samePeriod(candidateDate) ||
			candidateDate > options.eventDate ||
			(candidateDate === options.eventDate && candidate.id > options.entry.id)
		)
			return total;
		return total + options.usedAmountOf(candidate);
	}, 0);
	return { amount, percentage, exceededBy: Math.max(0, previouslyUsed) };
}

/** The reimbursable value of one amount under a resolved cap, rounded to the cent. */
export const reimbursable = (amount: number, cap: Pick<ResolvedEntryCap, 'percentage'>): number =>
	Math.round(amount * cap.percentage) / 100;

/**
 * The sentence a `BLOCK` cap refuses with, or `null` when the entry fits.
 *
 * `ALLOW` states a ceiling for reporting without enforcing it, so it never refuses.
 */
export function entryCapRefusal(options: {
	readonly cap: EntryCap;
	readonly resolved: ResolvedEntryCap;
	readonly componentCode: string;
	readonly subject: string;
	readonly proposed: number;
}): string | null {
	if (options.cap.on_exceed !== 'BLOCK' || options.proposed <= 0) return null;
	const requested = options.resolved.exceededBy + options.proposed;
	if (requested <= options.resolved.amount) return null;
	return (
		`${options.componentCode} entitlement exceeded for ${options.subject}: ` +
		`${(Math.round(requested * 100) / 100).toFixed(2)} requested against ` +
		`${(Math.round(options.resolved.amount * 100) / 100).toFixed(2)} allowed.`
	);
}
