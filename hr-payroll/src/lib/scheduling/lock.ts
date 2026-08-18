import type { WorkspaceRow } from '$bolt/types.js';

/**
 * The lock state of one calendar day, derived from the payroll runs that cover it.
 *
 * A day is either untouched, inside a draft run's assessment window (mutable, but on its way to
 * being settled), or inside a paid run's window (inputs immutable — corrections arrive as
 * adjustment entries in a later draft). Nothing about this is stored: the lock is arithmetic over
 * `payroll_runs` windows, so the same derived state drives the board's stripes and the write
 * hooks' refusals, and the two can never disagree.
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

/** The write-side guard: refuse an action on a day a paid run has already settled. */
export function assertNotSettled(
	windows: readonly PayrollWindow[],
	date: string,
	action: string
): void {
	const lock = lockStateForDate(windows, date);
	if (lock.kind === 'SETTLED') {
		throw new Error(sourceLockMessage({ kind: 'SETTLED', period: lock.period, date }, action));
	}
}

/**
 * Why a leave, claim, or attendance record cannot be written again.
 *
 * Pending approval is the platform's write-then-lock stamp. The other kinds are the domain freeze:
 * an approved (live) event, a day that has already passed, a paid payroll window, or a payslip
 * line that already consumed the row. Hooks and UI call the same function so they cannot disagree.
 */
export type SourceLock =
	| { readonly kind: 'NONE' }
	| { readonly kind: 'PENDING_APPROVAL' }
	| { readonly kind: 'APPROVED' }
	| { readonly kind: 'DATE_PASSED'; readonly date: string }
	| { readonly kind: 'SETTLED'; readonly period: string; readonly date: string }
	| { readonly kind: 'PAYSLIP_CONSUMED' };

export type SourceLockInput = {
	readonly existing: boolean;
	readonly approvalId?: string | null;
	readonly dates: readonly (string | Date | null | undefined)[];
	readonly today: string;
	readonly windows: readonly PayrollWindow[];
	readonly consumedByPayslip?: boolean;
	/** Live existing records are frozen — leave and claims after approval. */
	readonly freezeWhenLive?: boolean;
};

export type SourceLockI18nKey =
	| 'component.lock_pending_approval'
	| 'component.lock_approved'
	| 'component.lock_date_passed'
	| 'component.lock_settled'
	| 'component.lock_payslip_consumed';

export type SourceLockI18nParams =
	| { readonly date: string }
	| { readonly period: string; readonly date: string };

function rangeTouchesSettled(
	windows: readonly PayrollWindow[],
	start: string,
	end: string
): PayrollWindow | null {
	return (
		windows.find((window) => window.settled && window.start <= end && window.end >= start) ?? null
	);
}

/** The strongest lock that applies to this source record. */
export function sourceLock(input: SourceLockInput): SourceLock {
	const approvalId = input.approvalId;
	if (typeof approvalId === 'string' && approvalId.length > 0) {
		return { kind: 'PENDING_APPROVAL' };
	}
	if (input.consumedByPayslip === true) {
		return { kind: 'PAYSLIP_CONSUMED' };
	}
	const dates = input.dates.map((value) => dateKey(value)).filter((value) => value.length >= 10);
	const start = dates.reduce((min, value) => (value < min ? value : min), dates[0] ?? '');
	const end = dates.reduce((max, value) => (value > max ? value : max), dates[0] ?? '');
	if (start !== '') {
		const settled = rangeTouchesSettled(input.windows, start, end);
		if (settled != null) {
			return { kind: 'SETTLED', period: settled.period, date: start };
		}
	}
	if (input.existing && input.freezeWhenLive === true) {
		return { kind: 'APPROVED' };
	}
	if (input.existing && end !== '' && end < input.today) {
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
		case 'APPROVED':
			return `${action} is locked: the record is approved. Record a correction event instead.`;
		case 'DATE_PASSED':
			return `${action} on ${lock.date} is locked: that day has already passed.`;
		case 'SETTLED':
			return (
				`${action} on ${lock.date} is inside paid payroll ${lock.period} and cannot change. ` +
				'Correct it with an adjustment entry in a later draft run.'
			);
		case 'PAYSLIP_CONSUMED':
			return `${action} is locked: payroll has already consumed this entry.`;
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
		case 'APPROVED':
			return 'component.lock_approved';
		case 'DATE_PASSED':
			return 'component.lock_date_passed';
		case 'SETTLED':
			return 'component.lock_settled';
		case 'PAYSLIP_CONSUMED':
			return 'component.lock_payslip_consumed';
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
			return { period: lock.period, date: lock.date };
		case 'NONE':
		case 'PENDING_APPROVAL':
		case 'APPROVED':
		case 'PAYSLIP_CONSUMED':
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
