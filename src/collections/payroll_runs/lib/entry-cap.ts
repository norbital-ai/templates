/**
 * A pay line's entitlement ceiling, and what a candidate entry has left of it.
 *
 * The cap is stated once, on the catalogue row (`cap`, an `entitlement_cap`), and two callers need
 * the same answer at two different moments:
 *
 *   MEASURE   prices an entry and refuses the run when a `BLOCK` cap is exceeded.
 *   THE HOOK  refuses the entry when it is written, which is where a person can still fix it.
 *
 * Before this module the rule existed only in the first of those, so a twelfth claim against an
 * annual limit of ten was accepted, sat in the workspace, and took down the whole company's
 * payroll run weeks later — a refusal aimed at somebody who was not the person who made the
 * mistake, at a moment when it could no longer be corrected cheaply.
 *
 * The ceiling is a table of tiers: the first band whose predicate holds for the person is theirs,
 * per period. A person no band covers has no entitlement, which both callers treat as a refusal
 * rather than as "no ceiling".
 */

import type { EntitlementCap } from '../../../datatypes/entitlement_cap/+definition.js';
import { monthBounds, periodHalf, periodMonth, requiredDateKey } from './dates.js';
import { isEligible, type PersonContext } from './eligibility.js';

/** Recurring awards belong to the paid instalment, rather than the standing source's start date. */
export const capOccurrenceDate = (period: string) =>
	periodHalf(period) === 1
		? requiredDateKey(`${periodMonth(period)}-15`, 'cap occurrence date')
		: monthBounds(periodMonth(period)).end;

/** The entry columns this rule reads, so a hook may pass a candidate the database has never seen. */
type CapEntryLike = {
	readonly id: string;
	readonly employment_id: string;
};

type ResolvedEntryCap = {
	/** The ceiling in force for this person: the first band that covers them. */
	readonly amount: number;
	/** What earlier entries in the same capped period have already used of it. */
	readonly exceededBy: number;
};

type ResolveEntryCapOptions<TEntry extends CapEntryLike> = {
	readonly cap: EntitlementCap;
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
};

/** The band that covers this person, or `null` when none does: no entitlement. */
const entitlementBand = (cap: EntitlementCap, subject: PersonContext) =>
	cap.bands.find((band) => isEligible(band.eligibility, subject)) ?? null;

/**
 * The ceiling that governs, and what is already spent against it.
 *
 * `null` means no band covers this person: they have no entitlement under this line.
 */
export function resolveEntryCap<TEntry extends CapEntryLike>(
	options: ResolveEntryCapOptions<TEntry>
): ResolvedEntryCap | null {
	const band = entitlementBand(options.cap, options.subject);
	if (band == null) return null;

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
	return { amount: band.amount, exceededBy: Math.max(0, previouslyUsed) };
}

/** The sentence that refuses a person no band covers. */
export const noEntitlementRefusal = (componentCode: string, subject: string): string =>
	`${componentCode} has no entitlement band covering ${subject}.`;

/**
 * The sentence a `BLOCK` cap refuses with, or `null` when the entry fits.
 *
 * `ALLOW` states a ceiling for reporting without enforcing it, so it never refuses.
 */
export function entryCapRefusal(options: {
	readonly cap: EntitlementCap;
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
