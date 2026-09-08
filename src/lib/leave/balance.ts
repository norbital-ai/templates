import { refuse } from '@norbital-ai/bolt/authoring';
import type { LeaveAllocation } from '../../datatypes/leave_allocations/+definition.js';
import type { LeaveEvent, LeaveWindow } from '../../datatypes/leave_event/+definition.js';

/** Only approved manual activity and held debit reservations enter the balance query. */
export type LeaveBalanceEntry = {
	readonly id: string;
	readonly event: LeaveEvent;
	readonly allocations: readonly LeaveAllocation[];
	readonly approval_id: string | null;
};
export type EntitlementAt = (
	window: LeaveWindow,
	date: string
) => {
	readonly available: number | null;
	readonly earned: number | null;
};
const sameWindow = (a: LeaveWindow, b: LeaveWindow): boolean =>
	a.start === b.start && a.end === b.end;

type Credit = { readonly id: string | null; readonly available: string; readonly expires: string };
const creditsFor = (entries: readonly LeaveBalanceEntry[], window: LeaveWindow): Credit[] => [
	...entries.flatMap((entry): Credit[] =>
		entry.approval_id == null &&
		entry.event.kind === 'CARRY_FORWARD' &&
		sameWindow(entry.event.destination_window, window)
			? [{ id: entry.id, available: entry.event.available_from, expires: entry.event.expires_on }]
			: []
	),
	{ id: null, available: window.start, expires: window.end }
];

function allocationsIn(entries: readonly LeaveBalanceEntry[], window: LeaveWindow) {
	return entries.flatMap((entry) =>
		entry.allocations.filter(
			(allocation) =>
				sameWindow(allocation.window, window) && (entry.approval_id == null || allocation.days < 0)
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
	const base = credit.id === null ? entitlementAt(window, date)[basis] : 0;
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
}) {
	const { entries, window, date, entitlementAt } = options;
	const all = allocationsIn(entries, window);
	const posted = allocationsIn(
		entries.filter((entry) => entry.approval_id == null),
		window
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
}): LeaveAllocation[] {
	const { entries, window, date, days, entitlementAt } = options;
	if (!Number.isFinite(days) || days <= 0 || date < window.start || date > window.end)
		refuse('Leave allocation needs positive days inside its annual window.');
	const allocations = allocationsIn(entries, window);
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
		if (take > 0) result.push({ window, date, days: -take, credit_entry_id: credit.id });
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
	entitlementAt: EntitlementAt
): void {
	for (const window of windows) {
		const allocations = allocationsIn(entries, window);
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
	if (entry.event.kind === 'REVERSAL')
		refuse('Reverse the original activity once; use a new entry for a replacement.');
	return entry.allocations.map((allocation) => ({ ...allocation, days: -allocation.days }));
}
