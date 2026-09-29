import { refuse } from '../refuse.js';
import type { LeaveAllocation } from '../datatypes/leave_allocations.js';
import type { LeaveWindow } from './entitlement.js';
import type { LeaveEntryActivity } from './activity-fields.js';

/** Only approved manual activity and held debit reservations enter the balance query. */
export type LeaveBalanceEntry = LeaveEntryActivity & {
	readonly id: string;
	readonly allocations: readonly LeaveAllocation[];
	readonly approval_id: string | null;
	/** The entry's own leave code; an allocation without a `pool` draws from it. */
	readonly leave_code?: string | undefined;
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
	readonly unit?: 'DAY' | 'HOUR';
	readonly automaticCarryFrom?: LeaveWindow | null;
};
/**
 * The year a window carries from, read without pricing it. The carry source is a calendar fact, so
 * asking for it must not run the whole opening-day entitlement: a refusal attached to that day (no
 * sealed version, a mid-year policy, an SG attendance gap) is not a refusal on the carry.
 */
export type CarryFrom = (window: LeaveWindow) => LeaveWindow | null;
type Unit = 'DAY' | 'HOUR';
const unitAt = (entitlementAt: EntitlementAt, window: LeaveWindow, date: string): Unit =>
	entitlementAt(window, date).unit ?? 'DAY';
const quantityOf = (allocation: LeaveAllocation, unit: Unit): number =>
	unit === 'HOUR' ? (allocation.hours ?? 0) : allocation.days;
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
	readonly hours?: number | null;
	readonly available: string;
	readonly expires: string;
	readonly originalDate?: string;
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
				days: entry.days ?? 0,
				hours: entry.hours ?? null,
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
	const sources = entry.allocations.filter(
		(allocation) => allocation.days < 0 || (allocation.hours ?? 0) < 0
	);
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

const creditsFor = (
	entries: readonly LeaveBalanceEntry[],
	window: LeaveWindow,
	unit: Unit,
	entitlementAt: EntitlementAt,
	pool?: string,
	carryFrom?: CarryFrom | undefined
): Credit[] => [
	...entries.flatMap((entry): Credit[] => {
		const credit = entry.approval_id == null ? carryCredit(entry) : null;
		if (credit == null || !sameWindow(credit.window, window)) return [];
		if (unit === 'HOUR' && !(entry.hours != null && entry.hours > 0))
			refuse('An hourly carry credit needs its original hours.');
		return [{ ...credit, days: unit === 'HOUR' ? entry.hours! : credit.days }];
	}),
	...((): Credit[] => {
		const source = (carryFrom ?? ((own) => entitlementAt(own, own.start).automaticCarryFrom))(
			window
		);
		if (source == null) return [];
		const sourceUnit = unitAt(entitlementAt, source, source.end);
		if (
			entries.some(
				(entry) =>
					entry.approval_id != null &&
					entry.allocations.some(
						(row) =>
							sameWindow(row.window, source) &&
							drawsFrom(entry, row, pool) &&
							row.credit_entry_id == null &&
							(row.days < 0 || (row.hours ?? 0) < 0)
					)
			)
		)
			refuse('Resolve pending leave in the prior year before using its automatic carry.');
		const earned = entitlementAt(source, source.end).earned;
		if (earned == null) refuse('Automatic leave carry needs a finite prior-year entitlement.');
		const posted = allocationsIn(
			entries.filter((entry) => entry.approval_id == null),
			source,
			sourceUnit,
			pool
		);
		const quantity =
			earned +
			posted
				.filter((row) => row.credit_entry_id == null)
				.reduce((sum, row) => sum + quantityOf(row, sourceUnit), 0);
		if (quantity < -1e-9) refuse('Prior-year leave is overdrawn before automatic carry.');
		if (quantity <= 1e-9) return [];
		if (sourceUnit !== unit)
			refuse('Automatic leave carry needs the same day or hour unit in both years.');
		return [
			{
				id: `a17c0000-0000-4000-8000-${source.start.replaceAll('-', '').padStart(12, '0')}`,
				days: quantity,
				available: window.start,
				expires: window.end,
				originalDate: source.end
			}
		];
	})(),
	{ id: null, days: 0, available: window.start, expires: window.end }
];

function allocationsIn(
	entries: readonly LeaveBalanceEntry[],
	window: LeaveWindow,
	unit: Unit,
	pool?: string
) {
	return entries.flatMap((entry) =>
		entry.allocations
			.filter(
				(allocation) =>
					sameWindow(allocation.window, window) &&
					drawsFrom(entry, allocation, pool) &&
					(entry.approval_id == null || allocation.days < 0 || (allocation.hours ?? 0) < 0)
			)
			.map((allocation) => {
				if ((unit === 'HOUR') !== (allocation.hours != null))
					refuse('A leave allocation has a different unit from its entitlement.');
				return allocation;
			})
	);
}

/** Pending credits and pending reversals never make days available. */
function creditQuantity(
	allocations: readonly LeaveAllocation[],
	credit: Credit,
	date: string,
	window: LeaveWindow,
	entitlementAt: EntitlementAt,
	unit: Unit,
	basis: 'available' | 'earned' = 'available'
): number {
	if (unitAt(entitlementAt, window, date) !== unit)
		refuse('A leave year crossing hourly and day terms needs separate accounting.');
	const base = credit.id === null ? entitlementAt(window, date)[basis] : credit.days;
	if (base == null) return Infinity;
	return (
		base +
		allocations
			.filter((row) => row.credit_entry_id === credit.id && row.date <= date)
			.reduce((sum, row) => sum + quantityOf(row, unit), 0)
	);
}

function creditCapacity(
	allocations: readonly LeaveAllocation[],
	credit: Credit,
	date: string,
	window: LeaveWindow,
	entitlementAt: EntitlementAt,
	unit: Unit,
	basis: 'available' | 'earned' = 'available'
): number {
	let capacity = creditQuantity(allocations, credit, date, window, entitlementAt, unit, basis);
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
			creditQuantity(allocations, credit, future, window, entitlementAt, unit)
		);
	return Math.max(0, capacity);
}

export function leaveBalanceAt(options: {
	readonly entries: readonly LeaveBalanceEntry[];
	readonly window: LeaveWindow;
	readonly date: string;
	readonly entitlementAt: EntitlementAt;
	/** The pool measured, where the entries are those of another row drawing from it. */
	readonly pool?: string | undefined;
	readonly carryFrom?: CarryFrom | undefined;
}) {
	const { entries, window, date, entitlementAt } = options;
	const unit = unitAt(entitlementAt, window, date);
	const all = allocationsIn(entries, window, unit, options.pool);
	const posted = allocationsIn(
		entries.filter((entry) => entry.approval_id == null),
		window,
		unit,
		options.pool
	);
	let balance = 0,
		reservedBalance = 0,
		expired = 0;
	for (const credit of creditsFor(
		entries,
		window,
		unit,
		entitlementAt,
		options.pool,
		options.carryFrom
	)) {
		if (date < credit.available) continue;
		if (date > credit.expires && credit.id !== null) {
			expired += Math.max(0, creditQuantity(posted, credit, date, window, entitlementAt, unit));
			continue;
		}
		balance += creditQuantity(posted, credit, date, window, entitlementAt, unit);
		reservedBalance += creditCapacity(all, credit, date, window, entitlementAt, unit);
	}
	const pending =
		all.reduce((sum, row) => sum + quantityOf(row, unit), 0) -
		posted.reduce((sum, row) => sum + quantityOf(row, unit), 0);
	return {
		balance: Number.isFinite(balance) ? balance : null,
		available: Number.isFinite(reservedBalance) ? reservedBalance : null,
		pending: -pending,
		expired
	};
}

/** At departure, the current leave year's credit is earned through the last day; carried credits remain separate. */
export function leaveExitBalanceAt(options: Parameters<typeof leaveBalanceAt>[0]) {
	const { entries, window, date, entitlementAt } = options;
	const unit = unitAt(entitlementAt, window, date);
	const allocations = allocationsIn(entries, window, unit, options.pool);
	const reversed = new Set(
		entries.flatMap((entry) =>
			entry.approval_id == null &&
			entry.as_adjustment_entry === true &&
			entry.reversal_of_id != null
				? [entry.reversal_of_id]
				: []
		)
	);
	for (const entry of entries) {
		if (reversed.has(entry.id) || entry.reversal_of_id != null) continue;
		if (
			entry.allocations.some(
				(allocation) =>
					sameWindow(allocation.window, window) &&
					drawsFrom(entry, allocation, options.pool) &&
					allocation.date > date
			)
		)
			refuse('Exit leave pay needs future leave commitments reversed before departure settlement.');
		const futureCredit = entry.approval_id == null ? carryCredit(entry) : null;
		if (
			futureCredit != null &&
			sameWindow(futureCredit.window, window) &&
			futureCredit.available > date
		)
			refuse('Exit leave pay needs a carried credit available after departure reviewed.');
	}
	let current = 0;
	let carried = 0;
	for (const credit of creditsFor(
		entries,
		window,
		unit,
		entitlementAt,
		options.pool,
		options.carryFrom
	)) {
		if (date < credit.available || date > credit.expires) continue;
		const quantity = creditCapacity(
			allocations,
			credit,
			date,
			window,
			entitlementAt,
			unit,
			'earned'
		);
		if (!Number.isFinite(quantity)) refuse('Exit leave pay needs a finite earned balance.');
		if (credit.id === null) current += quantity;
		else carried += quantity;
	}
	return { current, carried };
}

/** Allocate expiring credit first while preserving every already approved or pending future debit. */
export function allocateLeaveDays(options: {
	readonly entries: readonly LeaveBalanceEntry[];
	readonly window: LeaveWindow;
	readonly date: string;
	readonly days: number;
	readonly unit?: Unit;
	readonly entitlementAt: EntitlementAt;
	readonly basis?: 'available' | 'earned' | undefined;
	/** The pool drawn from where it is another row's; the allocations carry it. */
	readonly pool?: string | undefined;
	readonly carryFrom?: CarryFrom | undefined;
}): LeaveAllocation[] {
	const { entries, window, date, days, entitlementAt } = options;
	if (!Number.isFinite(days) || days <= 0 || date < window.start || date > window.end)
		refuse('Leave allocation needs positive days inside its annual window.');
	const unit = options.unit ?? unitAt(entitlementAt, window, date);
	const allocations = allocationsIn(entries, window, unit, options.pool);
	let remaining = days;
	const result: LeaveAllocation[] = [];
	const credits = creditsFor(entries, window, unit, entitlementAt, options.pool, options.carryFrom)
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
			unit,
			options.basis
		);
		const take = Math.min(remaining, Math.max(0, capacity));
		if (take > 0) {
			const creditEntry =
				credit.id == null ? undefined : entries.find((row) => row.id === credit.id);
			const original_date =
				credit.originalDate ??
				(creditEntry == null
					? window.end
					: creditEntry.destination_from != null
						? creditOriginalDate(entries, creditEntry)
						: (creditEntry.to_date ?? window.end));
			result.push({
				window,
				date,
				days: unit === 'HOUR' ? 0 : -take,
				...(unit === 'HOUR' ? { hours: -take } : {}),
				credit_entry_id: credit.id,
				original_date,
				...(options.pool == null ? {} : { pool: options.pool })
			});
		}
		remaining -= take;
		// Every other comparison in this file allows a day's float; without it a whole balance
		// encashed leaves a residue of a few quadrillionths and refuses.
		if (remaining <= 1e-9) return result;
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
	pool?: string,
	carryFrom?: CarryFrom | undefined
): void {
	for (const window of windows) {
		const firstDate = entries
			.flatMap((entry) =>
				entry.allocations
					.filter(
						(allocation) =>
							sameWindow(allocation.window, window) && drawsFrom(entry, allocation, pool)
					)
					.map((allocation) => allocation.date)
			)
			.toSorted()[0];
		if (firstDate == null) continue;
		const unit = unitAt(entitlementAt, window, firstDate);
		const allocations = allocationsIn(entries, window, unit, pool);
		const credits = creditsFor(entries, window, unit, entitlementAt, pool, carryFrom);
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
					creditQuantity(allocations, credit, date, window, entitlementAt, unit) < -1e-9
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
		...entry.allocations.map((allocation) => ({
			...allocation,
			days: -allocation.days,
			...(allocation.hours == null ? {} : { hours: -allocation.hours })
		})),
		...(credit == null || (credit.days === 0 && !(credit.hours != null && credit.hours !== 0))
			? []
			: [
					{
						window: credit.window,
						date: credit.available,
						days: credit.hours == null ? -credit.days : 0,
						...(credit.hours == null ? {} : { hours: -credit.hours }),
						credit_entry_id: entry.id
					}
				])
	];
}
