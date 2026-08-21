import type { WorkspaceRow } from '$bolt/types.js';

/**
 * The lock state of one calendar day, derived from the payroll runs that cover it.
 *
 * A day is either untouched, inside a draft run's assessment window (mutable, but on its way to
 * being settled), or inside a paid run's window (no *new* record may appear — corrections arrive as
 * adjustment entries in a later draft). Nothing about *this* is stored: the day lock is arithmetic
 * over `payroll_runs` windows, so the same derived state drives the board's stripes and the write
 * hooks' refusals, and the two can never disagree.
 *
 * It is a question about **days**, and it used to be asked about records too. That was the mistake:
 * a record is settled because a payslip consumed it, not because it happens to be dated inside a
 * paid window, and the two answers differ for every draft run that has already produced payslips.
 * The record-level answer now lives in the `payslip_sources` collection and reaches `sourceLock`
 * below as `settledBy`. See `src/collections/payslip_sources/+model.ts`.
 *
 * The division of labour is worth stating in one line, because every guard in the workspace is one
 * side of it:
 *
 *     a RECORD is governed by the claim held over it;
 *     a DAY WITH NO RECORD is governed by the window, because there is no claim to ask —
 *     and a paid run has already priced that day's silence as absence.
 *
 * So the window arithmetic below answers exactly one write-side question — "may a record appear on
 * this day at all?" — and never "may this record change?". An existing record dated inside a paid
 * window that no run ever consumed stays editable and settles as arrears in a later run; that is
 * the case `payslip_sources/+model.ts` calls the second direction the old inference got wrong.
 *
 * `period` can name a whole month (`2026-08`) or half of one (`2026-08-1`, `2026-08-2`), matching
 * the company's pay grid. The board and the hooks only need the windows; they never interpret the
 * grid itself.
 */

export type PayrollRunLike = Pick<
	WorkspaceRow<'payroll_runs'>,
	'period' | 'lifecycle' | 'attendance_from' | 'attendance_to'
>;

export type PayrollWindow = {
	readonly start: string;
	readonly end: string;
	readonly period: string;
	readonly settled: boolean;
};

export type DayLock =
	| { readonly kind: 'NONE' }
	| { readonly kind: 'IN_WINDOW'; readonly period: string }
	| { readonly kind: 'SETTLED'; readonly period: string };

function dateKey(value: string | Date | null | undefined): string {
	if (value == null) return '';
	return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** Every run's assessment window, with whether the run has been paid. */
export function payrollWindows(runs: readonly PayrollRunLike[]): PayrollWindow[] {
	const windows: PayrollWindow[] = [];
	for (const run of runs) {
		const start = dateKey(run.attendance_from);
		const end = dateKey(run.attendance_to);
		if (start === '' || end === '' || end < start) continue;
		windows.push({ start, end, period: run.period, settled: run.lifecycle === 'PAID' });
	}
	return windows;
}

/** Which window, if any, covers a date. The first match wins; runs never overlap by construction. */
export function windowForDate(
	windows: readonly PayrollWindow[],
	date: string
): PayrollWindow | null {
	return windows.find((window) => date >= window.start && date <= window.end) ?? null;
}

/** The lock of one date. */
export function lockStateForDate(windows: readonly PayrollWindow[], date: string): DayLock {
	const window = windowForDate(windows, date);
	if (window == null) return { kind: 'NONE' };
	return window.settled
		? { kind: 'SETTLED', period: window.period }
		: { kind: 'IN_WINDOW', period: window.period };
}

/** One lock per date, for a board or a batch of writes. */
export function lockMap(
	windows: readonly PayrollWindow[],
	dates: readonly string[]
): Map<string, DayLock> {
	const locks = new Map<string, DayLock>();
	for (const date of dates) locks.set(date, lockStateForDate(windows, date));
	return locks;
}

/** The write-side guard: refuse a record *appearing* on a day a paid run has already settled. */
export function assertNotSettled(
	windows: readonly PayrollWindow[],
	date: string,
	action: string
): void {
	const lock = lockStateForDate(windows, date);
	if (lock.kind === 'SETTLED') {
		throw new Error(settledDayMessage(lock.period, date, action));
	}
}

/** The day-shaped refusal: a paid run has priced this day's silence as absence. */
function settledDayMessage(period: string, date: string, action: string): string {
	// Deliberately neutral about which act is being refused. This is the day-shaped refusal, and the
	// write it most often stops is a record trying to *appear* on a paid day rather than an existing
	// one trying to change — "cannot change" named the wrong act.
	return (
		`${action} on ${date} is refused: that day is inside paid payroll ${period}. ` +
		'Correct it with an adjustment entry in a later draft run.'
	);
}

/**
 * Why a leave, claim, or attendance record cannot be written again.
 *
 * Pending approval is the platform's write-then-lock stamp, and it stays the 409. The only other
 * domain freeze is the **settlement lock**: a database-enforced relation naming the record a payslip
 * took into account. Approval completion is not consumption and never freezes a record. A passed
 * date remains available only for the collections that explicitly ask for that policy.
 *
 * `PAID_DAY` is not produced by `sourceLock` — nothing a record carries can raise it. It is the
 * day-shaped inference a paid run's window makes about a *day*, kept here so the board's hover
 * sentence and the create guard (`assertNotSettled`) share one vocabulary with the record locks.
 */
export type SourceLock =
	| { readonly kind: 'NONE' }
	| { readonly kind: 'PENDING_APPROVAL' }
	| { readonly kind: 'SETTLED'; readonly period: string }
	| { readonly kind: 'DATE_PASSED'; readonly date: string }
	| { readonly kind: 'PAID_DAY'; readonly period: string; readonly date: string };

/** The claim a `payslip_sources` row makes, reduced to what a refusal has to say. */
export type SettlementClaim = { readonly period: string };

type SourceLockFacts = {
	readonly existing: boolean;
	readonly approvalId?: string | null;
	readonly dates: readonly (string | Date | null | undefined)[];
	/**
	 * The settlement claim held over this record, or null/undefined when none is.
	 *
	 * Passed in rather than looked up, for the same reason every other input is: this module stays
	 * pure so that the write hooks and the screens that grey the row out compute the identical lock
	 * from the identical inputs. Each caller reads `payslip_sources` through its own typed api.
	 */
	readonly settledBy?: SettlementClaim | null;
};

/**
 * Whether "the date is behind us" is a lock **on this collection**, stated by the caller.
 *
 * One collection says no and the others say yes, and the difference is not a preference. An expense
 * claim describes an event a person approved; editing one after its dates have gone by rewrites the
 * record of something that already either happened or did not, so that screen freezes the row and
 * offers a correction event instead. Attendance is the opposite shape entirely: a punch is *always*
 * recorded about a day that has passed — yesterday's clock-in, last week's missed swipe, a whole
 * month backfilled from a turnstile export. Freezing on a passed date there greys out every row a
 * controller has any reason to touch, which is the defect §2.2 of
 * `docs/attendance-on-the-board-proposal.md` names.
 *
 * The shape is a named policy rather than a boolean, and the two arms carry different fields, for
 * one reason: a call site must not be able to read as ambiguous. `datePassed: 'IS_NOT_A_LOCK'`
 * says what the caller decided in the caller's own words, and the arm forbids `today` outright —
 * a caller cannot both declare the date irrelevant and go on handing this function today's date.
 * The `'FREEZES'` arm is the one you get by saying nothing, so the collections that always froze
 * keep freezing without being touched; opting *out* is the change, and the change is the thing
 * that has to be visible.
 */
export type SourceLockInput = SourceLockFacts &
	(
		| { readonly datePassed?: 'FREEZES'; readonly today: string }
		| { readonly datePassed: 'IS_NOT_A_LOCK'; readonly today?: never }
	);

export type SourceLockI18nKey =
	| 'component.lock_pending_approval'
	| 'component.lock_date_passed'
	| 'component.lock_settled'
	| 'component.lock_settled_by_run';

export type SourceLockI18nParams =
	| { readonly date: string }
	| { readonly period: string }
	| { readonly period: string; readonly date: string };

/** The strongest lock that applies to this source record. */
export function sourceLock(input: SourceLockInput): SourceLock {
	const approvalId = input.approvalId;
	if (typeof approvalId === 'string' && approvalId.length > 0) {
		return { kind: 'PENDING_APPROVAL' };
	}
	/**
	 * The settlement lock is the one fact that can name the period holding the record, so its
	 * refusal is the only one that can tell the person what would have to happen to release it. It
	 * sits below `PENDING_APPROVAL` and not above it because the two cannot both be true —
	 * `gather.ts` only ever consumes rows whose `norbital_approval_id` is null — and because a
	 * pending row is the platform's 409, which `sourceLockBlocksWrite` leaves to the platform.
	 */
	if (input.settledBy != null) {
		return { kind: 'SETTLED', period: input.settledBy.period };
	}
	const dates = input.dates.map((value) => dateKey(value)).filter((value) => value.length >= 10);
	const end = dates.reduce((max, value) => (value > max ? value : max), dates[0] ?? '');
	// Read once, up front, so the arm below cannot accidentally consult a date the caller declared
	// irrelevant: on the opt-out arm there is no `today` to compare against at all.
	const today = input.datePassed === 'IS_NOT_A_LOCK' ? null : input.today;
	if (input.existing && today != null && end !== '' && end < today) {
		return { kind: 'DATE_PASSED', date: end };
	}
	return { kind: 'NONE' };
}

/** Pending approval is the platform's lock; domain freeze is everything else except NONE. */
export function sourceLockFrozen(lock: SourceLock): boolean {
	return lock.kind !== 'NONE';
}

/** Domain freeze that hooks must refuse. Pending approval stays a platform 409. */
export function sourceLockBlocksWrite(lock: SourceLock): boolean {
	return lock.kind !== 'NONE' && lock.kind !== 'PENDING_APPROVAL';
}

export function sourceLockMessage(lock: SourceLock, action: string): string {
	switch (lock.kind) {
		case 'NONE':
		case 'PENDING_APPROVAL':
			return `${action} is awaiting approval and cannot change here.`;
		case 'DATE_PASSED':
			return `${action} on ${lock.date} is locked: that day has already passed.`;
		case 'SETTLED':
			// The sentence the owner asked for: say what holds the record, and say what to do instead.
			// Both halves matter — "locked" on its own sends the person to look for a setting, and the
			// only two ways out are deleting the run (if it is still a draft) or an adjustment entry.
			return (
				`${action} is locked: payroll ${lock.period} has already taken this record into account. ` +
				'Delete that run to release it while it is still a draft, or correct it with an ' +
				'adjustment entry once it has been paid.'
			);
		case 'PAID_DAY':
			return settledDayMessage(lock.period, lock.date, action);
		default: {
			const _never: never = lock;
			return _never;
		}
	}
}

export function assertSourceUnlocked(lock: SourceLock, action: string): void {
	if (!sourceLockBlocksWrite(lock)) return;
	throw new Error(sourceLockMessage(lock, action));
}

/** Catalog key for the operator-facing lock sentence. */
export function sourceLockI18nKey(lock: SourceLock): SourceLockI18nKey | null {
	switch (lock.kind) {
		case 'NONE':
			return null;
		case 'PENDING_APPROVAL':
			return 'component.lock_pending_approval';
		case 'DATE_PASSED':
			return 'component.lock_date_passed';
		case 'SETTLED':
			return 'component.lock_settled_by_run';
		case 'PAID_DAY':
			return 'component.lock_settled';
		default: {
			const _never: never = lock;
			return _never;
		}
	}
}

export function sourceLockI18nParams(lock: SourceLock): SourceLockI18nParams | undefined {
	switch (lock.kind) {
		case 'DATE_PASSED':
			return { date: lock.date };
		case 'SETTLED':
			return { period: lock.period };
		case 'PAID_DAY':
			return { period: lock.period, date: lock.date };
		case 'NONE':
		case 'PENDING_APPROVAL':
			return undefined;
		default: {
			const _never: never = lock;
			return _never;
		}
	}
}

/** Operator-facing lock sentence, or null when the record is writable. */
export function sourceLockReason(
	lock: SourceLock,
	translate: (key: SourceLockI18nKey, vars?: SourceLockI18nParams) => string
): string | null {
	const key = sourceLockI18nKey(lock);
	if (key == null) return null;
	const params = sourceLockI18nParams(lock);
	return params == null ? translate(key) : translate(key, params);
}
