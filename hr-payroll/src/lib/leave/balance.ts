import { refuse } from '@norbital-ai/bolt/authoring';
import type { LeaveAllocation } from '../../datatypes/leave_allocations/+definition.js';
import type { LeaveWindow } from './entitlement.js';
import type { LeaveEntryActivity } from './activity-fields.js';

/** Only approved manual activity and held debit reservations enter the balance query. */
export type LeaveBalanceEntry = LeaveEntryActivity & {
	readonly id: string;
	readonly allocations: readonly LeaveAllocation[];
	readonly approval_id: string | null;
	/** The entry's own leave code; an allocation without a `pool` draws from it. */
	readonly leave_code?: string;
};

/**
 * Whether one allocation draws from the pool being measured: its own row when no pool is
 * named, else the named pool (`allocation.pool`) or the row itself when the entry is of that
 * code.
 */
const drawsFrom = (
	entry: LeaveBalanceEntry,
	allocation: LeaveAllocation,
	pool: string | undefined
): boolean =>
	pool === undefined
		? allocation.pool == null
		: allocation.pool === pool || (allocation.pool == null && entry.leave_code === pool);
export type EntitlementAt = (
	window: LeaveWindow,
	date: string
) => {
	readonly available: number | null;
	readonly earned: number | null;
};
const sameWindow = (a: LeaveWindow, b: LeaveWindow): boolean =>
	a.start === b.start && a.end === b.end;

/**
 * A carry-forward is its own credit: the approved entry's days, available and expiring on its own
 * dates. It never allocates to itself — a row cannot name its id before it is stored — so its
 * allocations hold only the source debit, and a reversal negates the credit by naming the entry.
 */
type Credit = {
	readonly id: string | null;
	readonly days: number;
	readonly available: string;
	readonly expires: string;
};
const carryCredit = (
	entry: LeaveBalanceEntry
): (Credit & { readonly window: LeaveWindow }) | null =>
	entry.destination_from != null &&
	entry.destination_to != null &&
	entry.available_from != null &&
	entry.expires_on != null
		? {
				id: entry.id,
				// A stored numeric arrives as a string; the credit adds it to consumed days.
				days: Number(entry.days ?? 0),
				available: entry.available_from,
				expires: entry.expires_on,
				window: { start: entry.destination_from, end: entry.destination_to }
			}
		: null;
/**
 * The salary-year end a credit's days originally belong to, through any number of transfers.
 *
 * A carry credit's own allocations hold the debits it moved; each of those names the credit it
 * came from. Walking that chain to an allocation that draws on computed entitlement (or a plain
 * manual credit) yields the original year end, which is the date the conversion rate is read on.
 * Null means the chain has no single origin and the encashment must refuse.
 */
export function creditOriginalDate(
	entries: readonly LeaveBalanceEntry[],
	entry: LeaveBalanceEntry
): string | null {
	const sources = entry.allocations.filter((allocation) => allocation.days < 0);
	if (sources.length === 0) return entry.to_date ?? null;
	const origins = new Set<string>();
	for (const source of sources) {
		if (source.original_date != null) {
			origins.add(source.original_date);
			continue;
		}
		const parent =
			source.credit_entry_id == null
				? undefined
				: entries.find((row) => row.id === source.credit_entry_id);
		const origin =
			parent != null && parent.destination_from != null
				? creditOriginalDate(entries, parent)
				: source.window.end;
		if (origin == null) return null;
		origins.add(origin);
	}
	return origins.size === 1 ? [...origins][0]! : null;
}

const creditsFor = (entries: readonly LeaveBalanceEntry[], window: LeaveWindow): Credit[] => [
	...entries.flatMap((entry): Credit[] => {
		const credit = entry.approval_id == null ? carryCredit(entry) : null;
		return credit != null && sameWindow(credit.window, window) ? [credit] : [];
	}),
	{ id: null, days: 0, available: window.start, expires: window.end }
];

function allocationsIn(entries: readonly LeaveBalanceEntry[], window: LeaveWindow, pool?: string) {
	return entries.flatMap((entry) =>
		entry.allocations.filter(
			(allocation) =>
				sameWindow(allocation.window, window) &&
				drawsFrom(entry, allocation, pool) &&
				(entry.approval_id == null || allocation.days < 0)
		)
	);
}

/** Pending credits and pending reversals never make days available. */
function creditQuantity(
	allocations: readonly LeaveAllocation[],
	credit: Credit,
	date: string,
	window: LeaveWindow,
	entitlementAt: EntitlementAt,
	basis: 'available' | 'earned' = 'available'
): number {
	const base = credit.id === null ? entitlementAt(window, date)[basis] : credit.days;
	if (base == null) return Infinity;
	return (
		base +
		allocations
			.filter((row) => row.credit_entry_id === credit.id && row.date <= date)
			.reduce((sum, row) => sum + row.days, 0)
	);
}

function creditCapacity(
	allocations: readonly LeaveAllocation[],
	credit: Credit,
	date: string,
	window: LeaveWindow,
	entitlementAt: EntitlementAt,
	basis: 'available' | 'earned' = 'available'
): number {
	let capacity = creditQuantity(allocations, credit, date, window, entitlementAt, basis);
	// Only dated commitments can reserve a current credit. Unused days do not require a
	// catalogue for every future date, particularly beyond the approved policy's coverage.
	const commitments = new Set(
		allocations
			.filter((row) => row.date > date && row.date <= credit.expires)
			.map((row) => row.date)
	);
	for (const future of commitments)
		capacity = Math.min(
			capacity,
			creditQuantity(allocations, credit, future, window, entitlementAt)
		);
	return Math.max(0, capacity);
}

export function leaveBalanceAt(options: {
	readonly entries: readonly LeaveBalanceEntry[];
	readonly window: LeaveWindow;
	readonly date: string;
	readonly entitlementAt: EntitlementAt;
	/** The pool measured, where the entries are those of another row drawing from it. */
	readonly pool?: string;
}) {
	const { entries, window, date, entitlementAt } = options;
	const all = allocationsIn(entries, window, options.pool);
	const posted = allocationsIn(
		entries.filter((entry) => entry.approval_id == null),
		window,
		options.pool
	);
	let balance = 0,
		reservedBalance = 0,
		expired = 0;
	for (const credit of creditsFor(entries, window)) {
		if (date < credit.available) continue;
		if (date > credit.expires && credit.id !== null) {
			expired += Math.max(0, creditQuantity(posted, credit, date, window, entitlementAt));
			continue;
		}
		balance += creditQuantity(posted, credit, date, window, entitlementAt);
		reservedBalance += creditCapacity(all, credit, date, window, entitlementAt);
	}
	const pending =
		all.reduce((sum, row) => sum + row.days, 0) - posted.reduce((sum, row) => sum + row.days, 0);
	return {
		balance: Number.isFinite(balance) ? balance : null,
		available: Number.isFinite(reservedBalance) ? reservedBalance : null,
		pending: -pending,
		expired
	};
}

/** Allocate expiring credit first while preserving every already approved or pending future debit. */
export function allocateLeaveDays(options: {
	readonly entries: readonly LeaveBalanceEntry[];
	readonly window: LeaveWindow;
	readonly date: string;
	readonly days: number;
	readonly entitlementAt: EntitlementAt;
	readonly basis?: 'available' | 'earned';
	/** The pool drawn from where it is another row's; the allocations carry it. */
	readonly pool?: string;
}): LeaveAllocation[] {
	const { entries, window, date, days, entitlementAt } = options;
	if (!Number.isFinite(days) || days <= 0 || date < window.start || date > window.end)
		refuse('Leave allocation needs positive days inside its annual window.');
	const allocations = allocationsIn(entries, window, options.pool);
	let remaining = days;
	const result: LeaveAllocation[] = [];
	const credits = creditsFor(entries, window)
		.filter((credit) => credit.available <= date && credit.expires >= date)
		.toSorted(
			(a, b) =>
				a.expires.localeCompare(b.expires) ||
				(a.id === null ? 1 : b.id === null ? -1 : a.id.localeCompare(b.id))
		);
	for (const credit of credits) {
		// Future dated allocations retain their original credits. A new earlier request cannot
		// silently spend those reserved days and move their later usage to a different credit.
		const capacity = creditCapacity(
			allocations,
			credit,
			date,
			window,
			entitlementAt,
			options.basis
		);
		const take = Math.min(remaining, Math.max(0, capacity));
		if (take > 0) {
			const creditEntry =
				credit.id == null ? undefined : entries.find((row) => row.id === credit.id);
			const original_date =
				creditEntry == null
					? window.end
					: creditEntry.destination_from != null
						? creditOriginalDate(entries, creditEntry)
						: (creditEntry.to_date ?? window.end);
			result.push({
				window,
				date,
				days: -take,
				credit_entry_id: credit.id,
				original_date,
				...(options.pool == null ? {} : { pool: options.pool })
			});
		}
		remaining -= take;
		if (remaining <= 0) return result;
	}
	refuse(
		`Insufficient leave in ${window.start}–${window.end}: ${remaining} more days are needed after existing commitments.`
	);
}

/** Validate a whole proposed batch, including carry destinations and restored original credits. */
export function assertLeaveBalanceIntegrity(
	entries: readonly LeaveBalanceEntry[],
	windows: readonly LeaveWindow[],
	entitlementAt: EntitlementAt,
	pool?: string
): void {
	for (const window of windows) {
		const allocations = allocationsIn(entries, window, pool);
		const credits = creditsFor(entries, window);
		for (const allocation of allocations) {
			const credit = credits.find((row) => row.id === allocation.credit_entry_id);
			if (!credit) refuse('A leave allocation refers to a missing or unapproved carry credit.');
			if (
				allocation.date < window.start ||
				allocation.date > window.end ||
				allocation.date < credit.available ||
				allocation.date > credit.expires
			)
				refuse('Leave can only consume a credit during its original validity.');
		}
		for (const date of new Set(allocations.map((row) => row.date)))
			for (const credit of credits)
				if (
					date >= credit.available &&
					creditQuantity(allocations, credit, date, window, entitlementAt) < -1e-9
				)
					refuse(
						`Leave credit would be overdrawn on ${date}. Existing usage and future reservations must remain funded.`
					);
	}
}

/** A full reversal restores the exact windows, dates and credits; it never resets expiry. */
export function reverseLeaveAllocations(entry: LeaveBalanceEntry): LeaveAllocation[] {
	if (entry.as_adjustment_entry === true)
		refuse('Reverse the original activity once; use a new entry for a replacement.');
	const credit = carryCredit(entry);
	return [
		...entry.allocations.map((allocation) => ({ ...allocation, days: -allocation.days })),
		...(credit == null || credit.days === 0
			? []
			: [
					{
						window: credit.window,
						date: credit.available,
						days: -credit.days,
						credit_entry_id: entry.id
					}
				])
	];
}
