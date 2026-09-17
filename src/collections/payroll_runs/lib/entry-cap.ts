/**
 * A catalogue band's entitlement ceiling, and what a candidate entry has left of it.
 *
 * The limit is stated on the band that prices the entry (`limit`), and two callers need the same
 * answer at two different moments:
 *
 *   MEASURE   prices an entry and refuses the run when a `BLOCK` limit is exceeded.
 *   THE HOOK  refuses the entry when it is written, which is where a person can still fix it.
 *
 * Usage is judged against every other entry of the same catalogue that settled in the same window,
 * measured in declaration order so two entries never each refuse the other.
 */

import type { Entitlement } from '../../../datatypes/entitlement/+definition.js';

/** The entry columns this rule reads, so a transform may pass a candidate the database has never seen. */
export type LimitSibling = {
	readonly id: string;
	readonly employment_id: string;
	readonly event_date: string | null;
	/** Signed usage already valued under this source's own band or captured output. */
	readonly amount: number;
};

type ResolvedLimit = {
	/** The ceiling in force: the band's stated amount. */
	readonly amount: number;
	/** What earlier entries in the same limited period have already used of it. */
	readonly exceededBy: number;
};

/** Whether a candidate date falls in the same window the limit counts over. */
function samePeriod(limit: Entitlement, candidateDate: string, eventDate: string): boolean {
	switch (limit.period) {
		case 'PER_EVENT':
			return false;
		case 'LIFETIME':
			return true;
		case 'MONTH':
			return candidateDate.slice(0, 7) === eventDate.slice(0, 7);
		case 'CALENDAR_YEAR':
			return candidateDate.slice(0, 4) === eventDate.slice(0, 4);
	}
}

/**
 * The ceiling that governs, and what is already spent against it.
 *
 * `null` means no limit is stated: the band is unbounded.
 */
export function resolveEntryLimit(options: {
	readonly limit: Entitlement | null;
	readonly limitAmount: number;
	readonly entryId: string;
	readonly employmentId: string;
	readonly eventDate: string;
	readonly siblings: readonly LimitSibling[];
}): ResolvedLimit | null {
	if (options.limit == null) return null;
	// Only what came *before* this entry counts against it; ties break on id so the order is total
	// and the same on every run.
	const previouslyUsed = options.siblings.reduce((total, candidate) => {
		if (
			candidate.employment_id !== options.employmentId ||
			candidate.id === options.entryId ||
			candidate.event_date == null
		)
			return total;
		if (
			!samePeriod(options.limit!, candidate.event_date, options.eventDate) ||
			candidate.event_date > options.eventDate ||
			(candidate.event_date === options.eventDate && candidate.id > options.entryId)
		)
			return total;
		return total + candidate.amount;
	}, 0);
	return { amount: options.limitAmount, exceededBy: Math.max(0, previouslyUsed) };
}

/**
 * The sentence a `BLOCK` limit refuses with, or `null` when the entry fits.
 *
 * `ALLOW` states a ceiling for reporting without enforcing it, so it never refuses.
 */
export function entryLimitRefusal(options: {
	readonly limit: Entitlement;
	readonly resolved: ResolvedLimit;
	readonly componentCode: string;
	readonly subject: string;
	readonly proposed: number;
}): string | null {
	if (options.limit.on_exceed !== 'BLOCK' || options.proposed <= 0) return null;
	const requested = options.resolved.exceededBy + options.proposed;
	if (requested <= options.resolved.amount) return null;
	return (
		`${options.componentCode} entitlement exceeded for ${options.subject}: ` +
		`${(Math.round(requested * 100) / 100).toFixed(2)} requested against ` +
		`${(Math.round(options.resolved.amount * 100) / 100).toFixed(2)} allowed.`
	);
}
