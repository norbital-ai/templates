import { Effect, Schema } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { WorkspaceRow } from '$bolt/types.js';
import { dateKey } from '../iso-day.js';

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
 * The record-level answer is a `payslip_adjustments` row naming the record, and it reaches
 * `sourceLock` below as `settledBy`. See `src/collections/payslip_adjustments/+model.ts`.
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
 * the second direction the old inference got wrong.
 *
 * `period` can name a whole month (`2026-08`) or half of one (`2026-08-1`, `2026-08-2`), matching
 * the company's pay grid. The board and the hooks only need the windows; they never interpret the
 * grid itself.
 */

type PayrollRunLike = Pick<
	WorkspaceRow<'payroll_runs'>,
	'period' | 'lifecycle' | 'attendance_from' | 'attendance_to'
>;

/** One run's assessment window, reduced to the arithmetic the day questions need. */
const payrollWindowSchema = Schema.Struct({
	start: Schema.String,
	end: Schema.String,
	period: Schema.String,
	settled: Schema.Boolean
});
export type PayrollWindow = Schema.Schema.Type<typeof payrollWindowSchema>;

/** How one calendar day stands, derived from the payroll runs covering it. */
export const dayLockSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('NONE') }),
	Schema.Struct({ kind: Schema.Literal('IN_WINDOW'), period: Schema.String }),
	Schema.Struct({ kind: Schema.Literal('SETTLED'), period: Schema.String })
]);
export type DayLock = Schema.Schema.Type<typeof dayLockSchema>;

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
function windowForDate(windows: readonly PayrollWindow[], date: string): PayrollWindow | null {
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
		refuse(settledDayMessage(lock.period, date, action));
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
const sourceLockSchema = Schema.Union([
	Schema.Struct({ kind: Schema.Literal('NONE') }),
	Schema.Struct({ kind: Schema.Literal('PENDING_APPROVAL') }),
	Schema.Struct({ kind: Schema.Literal('SETTLED'), period: Schema.String }),
	Schema.Struct({ kind: Schema.Literal('DATE_PASSED'), date: Schema.String }),
	Schema.Struct({ kind: Schema.Literal('PAID_DAY'), period: Schema.String, date: Schema.String })
]);

/** The claim a `payslip_adjustments` row makes, reduced to what a refusal has to say. */
const settlementClaimSchema = Schema.Struct({ period: Schema.String });
export type SourceLock = Schema.Schema.Type<typeof sourceLockSchema>;

/** The claim a `payslip_adjustments` row makes, reduced to what a refusal has to say. */
export type SettlementClaim = Schema.Schema.Type<typeof settlementClaimSchema>;

const sourceLockFactsSchema = Schema.Struct({
	existing: Schema.Boolean,
	approvalId: Schema.optional(Schema.NullOr(Schema.String)),
	dates: Schema.Array(Schema.NullOr(Schema.String)),
	/**
	 * The settlement claim held over this record, or null/undefined when none is.
	 *
	 * Passed in rather than looked up, for the same reason every other input is: this module stays
	 * pure so that the write hooks and the screens that grey the row out compute the identical lock
	 * from the identical inputs. Each caller reads `payslip_adjustments` through its own typed api,
	 * asking only whether a row names the record — never what that row is worth.
	 */
	settledBy: Schema.optional(Schema.NullOr(settlementClaimSchema))
});
type SourceLockFacts = Schema.Schema.Type<typeof sourceLockFactsSchema>;

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
 * `docs/scheduling-leave-proposal.md` names.
 *
 * The shape is a named policy rather than a boolean, and the two arms carry different fields, for
 * one reason: a call site must not be able to read as ambiguous. `datePassed: 'IS_NOT_A_LOCK'`
 * says what the caller decided in the caller's own words, and the arm forbids `today` outright —
 * a caller cannot both declare the date irrelevant and go on handing this function today's date.
 * The `'FREEZES'` arm is the one you get by saying nothing, so the collections that always froze
 * keep freezing without being touched; opting *out* is the change, and the change is the thing
 * that has to be visible.
 */
type SourceLockInput = SourceLockFacts &
	(
		| { readonly datePassed?: 'FREEZES'; readonly today: string }
		| { readonly datePassed: 'IS_NOT_A_LOCK'; readonly today?: never }
	);

const sourceLockI18nKeySchema = Schema.Literals([
	'component.lock_pending_approval',
	'component.lock_date_passed',
	'component.lock_settled',
	'component.lock_settled_by_run'
]);
type SourceLockI18nKey = Schema.Schema.Type<typeof sourceLockI18nKeySchema>;

const sourceLockI18nParamsSchema = Schema.Union([
	Schema.Struct({ date: Schema.String }),
	Schema.Struct({ period: Schema.String }),
	Schema.Struct({ period: Schema.String, date: Schema.String })
]);
type SourceLockI18nParams = Schema.Schema.Type<typeof sourceLockI18nParamsSchema>;

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
	 * `gather.ts` only ever consumes rows whose `approval_id` is null — and because a
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

/** The platform-owned approval lock. It is never an application/domain lock. */
export function sourceLockSystemLocked(lock: SourceLock): boolean {
	return lock.kind === 'PENDING_APPROVAL';
}

/** A lock imposed by this payroll application, separately from the platform approval lock. */
export function sourceLockApplicationLocked(lock: SourceLock): boolean {
	return lock.kind !== 'NONE' && !sourceLockSystemLocked(lock);
}

/** Domain freeze that hooks must refuse. Pending approval stays a platform 409. */
export function sourceLockBlocksWrite(lock: SourceLock): boolean {
	return sourceLockApplicationLocked(lock);
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

function sourceLockI18nParams(lock: SourceLock): SourceLockI18nParams | undefined {
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

/**
 * Projects an application-owned source lock into the collection surface contract.
 *
 * Pending approval deliberately produces no authored metadata: it is protected Bolt state and the
 * collection surfaces inject it directly from `approval_id`. This helper only adapts the
 * payroll application's own refusal, keeping the hook's lock calculation as the single source of
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

/** The columns the payroll engine writes when it captures or releases a single-use source. */
const SETTLEMENT_KEYS = new Set(['id', 'row_version', 'settled_payslip_id', 'settled_period']);

/** Whether a write is the engine's capture or release — the one write a settled row accepts. */
export function isSettlementWrite(input: Readonly<Record<string, unknown>>): boolean {
	return Object.keys(input).every((key) => SETTLEMENT_KEYS.has(key));
}

/** The claim a settled source carries, read off its own row. */
export function settledClaim(row: {
	readonly settled_period?: string | null;
}): { readonly period: string } | undefined {
	return row.settled_period == null ? undefined : { period: row.settled_period };
}

/**
 * The shared settlement-lock read, for every source family's update and delete hooks.
 *
 * Each hook supplies the capture lookup over its own junction — the generated client keeps its
 * per-collection query types — and this one decision turns whatever it finds into the same refusal
 * the screens compute from the same inputs. A pending approval still answers first (the platform's
 * 409, not ours); a capture names the period that has to release the record. Every settled source
 * carries `settled_period` exactly so this refusal never needs a `payroll_runs` read grant.
 */
type RefuseIfCapturedOptions = {
	readonly capture: Effect.Effect<{ readonly period: string } | undefined, never, never>;
	readonly approvalId: string | null | undefined;
	readonly action: string;
};

export function refuseIfCaptured(
	options: RefuseIfCapturedOptions
): Effect.Effect<void, never, never> {
	return Effect.map(options.capture, (row) => {
		const lock = sourceLock({
			existing: true,
			approvalId: options.approvalId,
			dates: [],
			settledBy: row == null ? null : { period: row.period },
			datePassed: 'IS_NOT_A_LOCK'
		});
		if (sourceLockBlocksWrite(lock)) {
			refuse(sourceLockMessage(lock, options.action));
		}
	});
}

/**
 * The plan half of a person-day is frozen once attendance has been recorded on it.
 *
 * The lock ladder above governs a record against payroll and approval. This is the rung it did not
 * have, and the owner's rule stated plainly: a work day may be shifted while nobody has clocked in
 * against it, and not afterwards. The reason is not tidiness — the plan is what the punch was
 * *measured against*. Day type, paid minutes, the overtime threshold and every rest-break figure
 * come off the roster code, so changing the code under a recorded punch retro-scores attendance
 * that already happened, silently and with no trace that the number moved.
 *
 * It reads the stored intervals, never the incoming ones: the question is whether attendance was
 * already on this day before this write, not whether the write brings some. That is what lets the
 * kiosk keep punching — a punch writes `worked_intervals` and `break_minutes` and never touches the
 * plan — and what lets HR correct a punch on a planned day.
 *
 * `null` is "no attendance was recorded"; `[]` is "the day was reviewed and produced nothing",
 * which is a statement somebody made about the day and is therefore just as much a lock.
 */
export const attendanceRecorded = (intervals: unknown): boolean => Array.isArray(intervals);

/** The plan columns, which are exactly the ones attendance freezes. */
const PLAN_COLUMNS = ['shift_definition_id', 'assignment_code', 'planned_origin'] as const;

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
/** The settlement claim of a single-use row, in the array shape the badge helper reads. */
export function settledClaims(row: {
	readonly settled_period?: string | null;
}): ReadonlyArray<{ readonly period: string }> {
	return row.settled_period == null ? [] : [{ period: row.settled_period }];
}

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
