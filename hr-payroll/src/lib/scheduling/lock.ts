import { refuse } from '../refuse.js';
import { dateKey } from '../iso-day.js';
import * as Predicate from 'effect/Predicate';

/**
 * The lock state of one person's calendar day, derived from the payroll that covers it: untouched,
 * inside a draft window, or inside a window already paid (no new record may appear; corrections are
 * adjustment entries in a later run). Nothing is stored, so the board and the transforms agree.
 *
 * The lock is the payslip's, not the run's: a window is settled for an employment when that
 * person's slip is paid, or as soon as an EARLY run has settled their salary ahead of the regular
 * run (the period's pay is fixed from then on; a change is recorded in the next period). A record is governed by the payslip that consumed it (`settledBy`); a day
 * with no record is governed by the window — "may a record appear here?", never "may it change?".
 * `period` is a month (`2026-08`) or a half (`2026-08-1`).
 */

type PayrollRunLike = {
	readonly id?: string | undefined;
	readonly period: string;
	/** `EARLY` settles its window for its people the moment it stands, paid or not. */
	readonly kind?: string | null | undefined;
	readonly attendance_from: string;
	readonly attendance_to: string;
};

/** The payslips a window's settlement is read from: one per person, paid or not. */
type PayslipLike = {
	readonly payroll_run_id?: string | undefined;
	readonly employment_id: string;
	readonly paid_at?: unknown | undefined;
};

/** One run's assessment window, reduced to the arithmetic the day questions need. */
export type PayrollWindow = {
	readonly start: string;
	readonly end: string;
	readonly period: string;
	/** The employments whose payslip in this run has been paid. Everyone else is still open. */
	readonly settledFor: ReadonlySet<string>;
	/** An EARLY run's window: settled for its people before anything is paid. */
	readonly early?: boolean | undefined;
};

/** How one calendar day stands, derived from the payroll runs covering it. */
export type DayLock =
	| {
			readonly kind: 'NONE';
	  }
	| {
			readonly kind: 'IN_WINDOW';
			readonly period: string;
	  }
	| {
			readonly kind: 'SETTLED';
			readonly period: string;
			/** Settled by an EARLY run: the change belongs in the next period. */
			readonly early?: boolean | undefined;
	  };

export function payrollWindows(
	runs: readonly PayrollRunLike[],
	payslips: readonly PayslipLike[] = []
): PayrollWindow[] {
	const early = new Set(runs.filter((run) => run.kind === 'EARLY').map((run) => run.id ?? ''));
	const paidByRun = new Map<string, Set<string>>();
	for (const slip of payslips) {
		const runId = slip.payroll_run_id ?? '';
		if (slip.paid_at == null && !early.has(runId)) continue;
		const held = paidByRun.get(runId) ?? new Set<string>();
		held.add(slip.employment_id);
		paidByRun.set(runId, held);
	}
	const windows: PayrollWindow[] = [];
	for (const run of runs) {
		const start = dateKey(run.attendance_from);
		const end = dateKey(run.attendance_to);
		if (start === '' || end === '' || end < start) continue;
		windows.push({
			start,
			end,
			period: run.period,
			settledFor: paidByRun.get(run.id ?? '') ?? new Set<string>(),
			...(run.kind === 'EARLY' ? { early: true } : {})
		});
	}
	return windows;
}

/** The lock of one person's date: settled by any run of the period that settled them, else the first covering. */
export function lockStateForDate(
	windows: readonly PayrollWindow[],
	date: string,
	employmentId: string
): DayLock {
	// The runs of one period share a window (REGULAR, EARLY, OFF_CYCLE…): any that settled the person locks it.
	const covering = windows.filter((window) => date >= window.start && date <= window.end);
	// An early settlement says where the change goes (the next period), so it answers first.
	const settled =
		covering.find((window) => window.early === true && window.settledFor.has(employmentId)) ??
		covering.find((window) => window.settledFor.has(employmentId));
	if (settled != null)
		return {
			kind: 'SETTLED',
			period: settled.period,
			...(settled.early === true ? { early: true } : {})
		};
	const window = covering[0];
	return window == null ? { kind: 'NONE' } : { kind: 'IN_WINDOW', period: window.period };
}

/** The key a person-day lock is filed under, so a board can read one map for every cell. */
export const dayLockKey = (employmentId: string, date: string): string => `${employmentId}:${date}`;

/** One lock per person-day, for a board or a batch of writes. */
export function lockMap(
	windows: readonly PayrollWindow[],
	dates: readonly string[],
	employmentIds: readonly string[]
): Map<string, DayLock> {
	const locks = new Map<string, DayLock>();
	for (const employmentId of employmentIds)
		for (const date of dates)
			locks.set(dayLockKey(employmentId, date), lockStateForDate(windows, date, employmentId));
	return locks;
}

/** The write-side guard: refuse a record *appearing* on a day this person has already been paid for. */
export function assertNotSettled(
	windows: readonly PayrollWindow[],
	date: string,
	action: string,
	employmentId: string
): void {
	const lock = lockStateForDate(windows, date, employmentId);
	if (lock.kind === 'SETTLED') {
		refuse(settledDayMessage(lock.period, date, action, lock.early === true));
	}
}

/** The day-shaped refusal: a paid run has priced this day's silence as absence. */
function settledDayMessage(period: string, date: string, action: string, early = false): string {
	if (early)
		return (
			`${action} on ${date} is refused: this person's ${period} salary was settled early, beside an ` +
			'off-cycle run, so that period is fixed. Record the change in the next payroll period.'
		);
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
 * Pending approval is the platform's hold-before-commit state, and it stays the 409. The only other
 * domain freeze is the **settlement lock**: a `payslip_adjustments` row whose database-enforced
 * `restrict` reference names the record a payslip took into account. Its amount is irrelevant — a
 * zero says the run read the source and priced it at nothing, which is a settlement and not an
 * absence — so the lock asks whether such a row exists and never what it is worth. Approval
 * completion is not consumption and never freezes a record. A passed date remains available only
 * for the collections that explicitly ask for that policy.
 *
 * `PAID_DAY` is not produced by `sourceLock` — nothing a record carries can raise it. It is the
 * day-shaped inference a paid run's window makes about a *day*, kept here so the board's hover
 * sentence and the create guard (`assertNotSettled`) share one vocabulary with the record locks.
 */
export type SourceLock =
	| {
			readonly kind: 'NONE';
	  }
	| {
			readonly kind: 'PENDING_APPROVAL';
	  }
	| {
			readonly kind: 'SETTLED';
			readonly period: string | null;
	  }
	| {
			readonly kind: 'DATE_PASSED';
			readonly date: string;
	  }
	| {
			readonly kind: 'PAID_DAY';
			readonly period: string;
			readonly date: string;
	  };

/** The claim a `payslip_adjustments` row makes, reduced to what a refusal has to say. */
export type SettlementClaim = {
	readonly period: string | null;
};

type SourceLockFacts = {
	readonly existing: boolean;
	readonly approvalId?: string | null | undefined;
	readonly dates: ReadonlyArray<string | null>;
	/**
	 * The settlement claim held over this record, or null/undefined when none is.
	 *
	 * Passed in rather than looked up, for the same reason every other input is: this module stays
	 * pure so that the transforms and the screens that grey the row out compute the identical lock
	 * from the identical inputs. Each caller reads `payslip_adjustments` through its own typed api,
	 * asking only whether a row names the record — never what that row is worth.
	 */
	readonly settledBy?: SettlementClaim | null | undefined;
};

/**
 * Whether a passed date locks this collection, stated by the caller: a claim freezes once its dates
 * pass (a correction is a new event), attendance never does — a punch is always about a past day
 * (`docs/scheduling.md`). `'IS_NOT_A_LOCK'` forbids passing `today`; `'FREEZES'` is the default.
 */
type SourceLockInput = SourceLockFacts &
	(
		| { readonly datePassed?: 'FREEZES'; readonly today: string }
		| { readonly datePassed: 'IS_NOT_A_LOCK'; readonly today?: never }
	);

type SourceLockI18nKey =
	| 'component.lock_pending_approval'
	| 'component.lock_date_passed'
	| 'component.lock_settled'
	| 'component.lock_settled_by_run';

type SourceLockI18nParams =
	| {
			readonly date: string;
	  }
	| {
			readonly period: string;
	  }
	| {
			readonly period: string;
			readonly date: string;
	  };

/** The strongest lock that applies to this source record. */
export function sourceLock(input: SourceLockInput): SourceLock {
	const approvalId = input.approvalId;
	if (Predicate.isString(approvalId) && approvalId.length > 0) {
		return { kind: 'PENDING_APPROVAL' };
	}
	/**
	 * The settlement lock is the one fact that can name the period holding the record, so its
	 * refusal is the only one that can tell the person what would have to happen to release it. It
	 * sits below `PENDING_APPROVAL` and not above it because the two cannot both be true —
	 * `gather.ts` only ever consumes rows whose `approval_id` is null — and because a
	 * pending row is the platform's 409, which `sourceLockApplicationLocked` leaves to the platform.
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

/**
 * A lock imposed by this payroll application: the domain freeze transforms must refuse. The
 * platform-owned approval lock (`PENDING_APPROVAL`) is never one; it stays a platform hold.
 */
export function sourceLockApplicationLocked(lock: SourceLock): boolean {
	return lock.kind !== 'NONE' && lock.kind !== 'PENDING_APPROVAL';
}

export function sourceLockMessage(lock: SourceLock, action: string): string {
	switch (lock.kind) {
		case 'NONE':
			return `${action} can change.`;
		case 'PENDING_APPROVAL':
			return `System lock: ${action.toLowerCase()} is awaiting approval and cannot change until the request closes.`;
		case 'DATE_PASSED':
			return `${action} on ${lock.date} is locked: that day has already passed.`;
		case 'SETTLED':
			// The sentence the owner asked for: say what holds the record, and say what to do instead.
			// Both halves matter — "locked" on its own sends the person to look for a setting, and the
			// only two ways out are deleting the run (if it is still a draft) or an adjustment entry.
			return (
				`${action} is locked: payroll ` +
				(lock.period == null ? 'has' : `${lock.period} has`) +
				' already taken this record into account. Delete that run to release it while it is ' +
				'still a draft, or correct it with an adjustment entry once it has been paid.'
			);
		case 'PAID_DAY':
			return settledDayMessage(lock.period, lock.date, action);
		default: {
			const _never: never = lock;
			return _never;
		}
	}
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

function sourceLockI18nParams(lock: SourceLock): SourceLockI18nParams | undefined {
	switch (lock.kind) {
		case 'DATE_PASSED':
			return { date: lock.date };
		case 'SETTLED':
			return lock.period == null ? undefined : { period: lock.period };
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

/**
 * Projects an application-owned source lock into the collection surface contract.
 *
 * Pending approval deliberately produces no authored metadata: it is protected Bolt state and the
 * collection surfaces inject it directly from `approval_id`. This helper only adapts the
 * payroll application's own refusal, keeping the transform's lock calculation as the single source of
 * truth without letting application code impersonate system metadata.
 */
export function sourceLockRecordMetadata(
	lock: SourceLock,
	translate: (key: SourceLockI18nKey, vars?: SourceLockI18nParams) => string
) {
	if (!sourceLockApplicationLocked(lock)) return [] as const;
	const reason = sourceLockReason(lock, translate);
	if (reason == null) return [] as const;
	return [
		{
			kind: 'restriction',
			operations: ['update', 'delete'],
			reason
		}
	] as const;
}

/** The claim a settled source carries, read off its own row. The period is read through the slip. */
function settledClaim(row: {
	readonly payslip_id?: string | null | undefined;
}): { readonly period: string | null } | undefined {
	return row.payslip_id == null ? undefined : { period: null };
}

/**
 * The shared settlement-lock decision, for every source family's update transform.
 *
 * The pinned `payslip_id` names the slip that has to release the record, so this refusal never
 * needs a `payroll_runs` read; a pending approval still answers first (the platform's hold, not
 * ours). One decision turns the row into the same refusal the screens compute from the same
 * inputs.
 */
export function assertNotCaptured(
	row: { readonly payslip_id?: string | null; readonly approval_id?: string | null },
	action: string
): void {
	const lock = sourceLock({
		existing: true,
		approvalId: row.approval_id ?? null,
		dates: [],
		settledBy: settledClaim(row) ?? null,
		datePassed: 'IS_NOT_A_LOCK'
	});
	if (sourceLockApplicationLocked(lock)) refuse(sourceLockMessage(lock, action));
}

/**
 * The plan half of a person-day is frozen once attendance is recorded on it (owner's rule): day
 * type, paid minutes and overtime thresholds come off the roster code, so changing it would
 * retro-score a punch. It reads the stored intervals, so the kiosk and HR may still punch; `[]` (a
 * reviewed empty day) locks like any attendance, `null` does not.
 */
export const attendanceRecorded = (intervals: unknown): boolean => Array.isArray(intervals);

/** The plan columns, which are exactly the ones attendance freezes. */
const PLAN_COLUMNS = ['shift_definition_id'] as const;

/**
 * Which plan columns this write would change, given what the row already holds. Empty means the
 * write leaves the plan alone, whatever else it does.
 */
export const planChanges = (
	input: Readonly<Record<string, unknown>>,
	existing: Readonly<Record<string, unknown>>
): readonly string[] =>
	PLAN_COLUMNS.filter((column) => {
		if (input[column] === undefined) return false;
		// A column the row never carried reads back as `undefined`, and a write that states "no
		// plan" sends `null`. Those are one state, and a caller that restates it is changing
		// nothing — which is exactly what an ordinary attendance edit does when it echoes the plan
		// columns back unchanged.
		const before = existing[column] ?? null;
		return (input[column] ?? null) !== before;
	});

/**
 * The lock a pay request row carries, as the row metadata a table reads.
 *
 * Six surfaces needed this and each had written it out: the five family pages under the Events
 * group and the employee's own view. They differed in one thing — the name of the relation the
 * capture rides in on — which is a name the caller already holds, so the body belongs here rather
 * than six times over.
 *
 * `datePassed: 'IS_NOT_A_LOCK'` is the whole reason this is not `sourceLock` called directly: a
 * pay request dated in the past is ordinary, and only a settlement or a pending approval freezes
 * one.
 */
export function payRequestRecordMetadata(
	approvalId: string | null,
	captures: ReadonlyArray<{ readonly period: string }> | null | undefined,
	translate: (key: SourceLockI18nKey, vars?: SourceLockI18nParams) => string
) {
	const capture = captures?.[0] ?? null;
	return sourceLockRecordMetadata(
		sourceLock({
			existing: true,
			approvalId,
			dates: [],
			settledBy: capture == null ? null : { period: capture.period },
			datePassed: 'IS_NOT_A_LOCK'
		}),
		translate
	);
}
