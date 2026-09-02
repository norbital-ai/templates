// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
/**
 * The attendance write path these locks govern.
 *
 * `time_entries` and `roster_entries` are one collection now, so the hooks that refuse a punch on a
 * settled day live on `work_days`. This file owns the lock arithmetic; the cases below are here
 * because a lock nothing enforces is a lock nobody has, and they are the only place the two halves
 * are asserted together.
 */
import workDayHooks from '../../src/collections/work_days/+hooks.ts';
import {
	payrollWindows,
	lockStateForDate,
	lockMap,
	assertNotSettled,
	sourceLock,
	sourceLockSystemLocked,
	sourceLockApplicationLocked,
	sourceLockRecordMetadata,
	sourceLockBlocksWrite,
	assertSourceUnlocked
} from '../../src/lib/scheduling/lock.ts';

/**
 * Two runs of one company, in the shape the real read returns them.
 *
 * `company_id` is not decoration: `mutate.prepare` selects it and groups the windows by it, because
 * company is the key a record can reach on its own (employment → company). Without it every window
 * landed under `undefined`, the lookup for `co-1` found nothing, and the paid-window refusal below
 * silently did not fire — a fixture describing a response the api does not return.
 */
const monthly = [
	{
		company_id: 'co-1',
		period: '2026-08',
		lifecycle: 'DRAFT',
		attendance_from: '2026-07-21',
		attendance_to: '2026-08-20'
	},
	{
		company_id: 'co-1',
		period: '2026-07',
		lifecycle: 'PAID',
		attendance_from: '2026-06-21',
		attendance_to: '2026-07-20'
	}
];

test('windows are derived from every run, with their settled state', () => {
	const windows = payrollWindows(monthly);
	assert.deepEqual(windows, [
		{ start: '2026-07-21', end: '2026-08-20', period: '2026-08', settled: false },
		{ start: '2026-06-21', end: '2026-07-20', period: '2026-07', settled: true }
	]);
});

test('a day outside every window is untouched', () => {
	const windows = payrollWindows(monthly);
	assert.deepEqual(lockStateForDate(windows, '2026-08-21'), { kind: 'NONE' });
});

test('a day inside a draft window is in-window; a paid one is settled', () => {
	const windows = payrollWindows(monthly);
	assert.deepEqual(lockStateForDate(windows, '2026-08-01'), {
		kind: 'IN_WINDOW',
		period: '2026-08'
	});
	assert.deepEqual(lockStateForDate(windows, '2026-07-01'), {
		kind: 'SETTLED',
		period: '2026-07'
	});
});

test('semi-monthly periods lock the exact half they cover', () => {
	const windows = payrollWindows([
		{
			period: '2026-08-1',
			lifecycle: 'PAID',
			attendance_from: '2026-07-21',
			attendance_to: '2026-08-05'
		},
		{
			period: '2026-08-2',
			lifecycle: 'DRAFT',
			attendance_from: '2026-08-06',
			attendance_to: '2026-08-20'
		}
	]);
	assert.deepEqual(lockStateForDate(windows, '2026-08-05'), {
		kind: 'SETTLED',
		period: '2026-08-1'
	});
	assert.deepEqual(lockStateForDate(windows, '2026-08-06'), {
		kind: 'IN_WINDOW',
		period: '2026-08-2'
	});
	assert.deepEqual(lockStateForDate(windows, '2026-08-21'), { kind: 'NONE' });
});

test('lockMap builds one lock per date', () => {
	const locks = lockMap(payrollWindows(monthly), ['2026-06-30', '2026-07-21', '2026-09-01']);
	assert.deepEqual(
		[...locks.values()],
		[
			{ kind: 'SETTLED', period: '2026-07' },
			{ kind: 'IN_WINDOW', period: '2026-08' },
			{ kind: 'NONE' }
		]
	);
});

test('assertNotSettled refuses a settled day and passes every other state', () => {
	const windows = payrollWindows(monthly);
	assert.throws(
		() => assertNotSettled(windows, '2026-07-01', 'Changing attendance'),
		/inside paid payroll 2026-07/
	);
	assert.doesNotThrow(() => assertNotSettled(windows, '2026-08-01', 'Changing attendance'));
	assert.doesNotThrow(() => assertNotSettled(windows, '2026-08-25', 'Changing attendance'));
});

test('approval completion is not a lock, while passed dates remain opt-in policy', () => {
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-08-25'],
			today: '2026-08-18'
		}),
		{ kind: 'NONE' }
	);
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-08-10'],
			today: '2026-08-18'
		}),
		{ kind: 'DATE_PASSED', date: '2026-08-10' }
	);
	assert.equal(
		sourceLock({
			existing: false,
			dates: ['2026-08-10'],
			today: '2026-08-18'
		}).kind,
		'NONE'
	);
});

test('consumption outranks date policy, and pending approval outranks everything', () => {
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-08-25'],
			today: '2026-08-18',
			settledBy: { period: '2026-07' }
		}),
		{ kind: 'SETTLED', period: '2026-07' }
	);
	assert.deepEqual(
		sourceLock({
			existing: true,
			approvalId: 'req-1',
			dates: ['2026-08-25'],
			today: '2026-08-18',
			settledBy: { period: '2026-07' }
		}),
		{ kind: 'PENDING_APPROVAL' }
	);
});

test('assertSourceUnlocked refuses domain freezes and leaves pending approval to the platform', () => {
	assert.doesNotThrow(() => assertSourceUnlocked({ kind: 'NONE' }, 'Changing a leave request'));
	assert.doesNotThrow(() =>
		assertSourceUnlocked({ kind: 'PENDING_APPROVAL' }, 'Changing a leave request')
	);
	assert.equal(sourceLockBlocksWrite({ kind: 'PENDING_APPROVAL' }), false);
	assert.throws(
		() => assertSourceUnlocked({ kind: 'SETTLED', period: '2026-07' }, 'Changing a leave request'),
		/taken this record into account/
	);
});

test('approval and application locks stay explicitly classified', () => {
	const pendingApproval = { kind: 'PENDING_APPROVAL' } as const;
	const settled = { kind: 'SETTLED', period: '2026-07' } as const;
	const unlocked = { kind: 'NONE' } as const;

	assert.equal(sourceLockSystemLocked(pendingApproval), true);
	assert.equal(sourceLockApplicationLocked(pendingApproval), false);
	assert.equal(sourceLockSystemLocked(settled), false);
	assert.equal(sourceLockApplicationLocked(settled), true);
	assert.equal(sourceLockSystemLocked(unlocked), false);
	assert.equal(sourceLockApplicationLocked(unlocked), false);
});

test('only application locks become authored record metadata', () => {
	const translate = (key, vars) => `${key}${vars?.period ? `:${vars.period}` : ''}`;

	assert.deepEqual(sourceLockRecordMetadata({ kind: 'PENDING_APPROVAL' }, translate), []);
	assert.deepEqual(sourceLockRecordMetadata({ kind: 'NONE' }, translate), []);
	assert.deepEqual(sourceLockRecordMetadata({ kind: 'SETTLED', period: '2026-07' }, translate), [
		{
			kind: 'restriction',
			operations: ['update', 'delete'],
			reason: 'component.lock_settled_by_run:2026-07'
		}
	]);
});

/**
 * §2 of `docs/attendance-on-the-board-proposal.md`, which is the contract these cover:
 * a record is governed by the claim held over it, and a day with no record by the window. A passed
 * date governs nothing on attendance; a paid window never governs an existing record at all.
 */

test('attendance opts out of the passed-date freeze and stays writable', () => {
	// The same row that reads DATE_PASSED for claims two tests below. Every punch ever recorded is
	// about a day that has gone by; freezing on that greys out the entire month a controller works.
	assert.deepEqual(
		sourceLock({
			existing: true,
			approvalId: null,
			dates: ['2026-08-10'],
			settledBy: null,
			datePassed: 'IS_NOT_A_LOCK'
		}),
		{ kind: 'NONE' }
	);
	// A month-old backfill, well behind today, with no claim of any kind over it.
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-05-04'],
			datePassed: 'IS_NOT_A_LOCK'
		}),
		{ kind: 'NONE' }
	);
});

test('a caller that does not opt out still gets the passed-date policy', () => {
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-08-10', '2026-08-12'],
			today: '2026-08-18'
		}),
		{ kind: 'DATE_PASSED', date: '2026-08-12' }
	);
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-08-10'],
			today: '2026-08-18',
			datePassed: 'FREEZES'
		}),
		{ kind: 'DATE_PASSED', date: '2026-08-10' }
	);
});

test('a claim refuses whatever the run’s lifecycle, and whatever the windows say', () => {
	// The claim is a stored fact and the only lock that survives on the attendance record path, so
	// it has to answer on its own — with no paid window to lean on, and with the run still a draft.
	// The window input is gone from `sourceLock` entirely: a paid window never freezes an existing
	// record, because the window answers "may a record appear on this day" and nothing else.
	for (const settledBy of [{ period: '2026-08' }, { period: '2026-07' }]) {
		const lock = sourceLock({
			existing: true,
			dates: [],
			settledBy,
			datePassed: 'IS_NOT_A_LOCK'
		});
		assert.deepEqual(lock, { kind: 'SETTLED', period: settledBy.period });
		assert.equal(sourceLockBlocksWrite(lock), true);
	}
});

/**
 * A database double whose surface is exactly the reads the attendance hooks make.
 *
 * The last two cases below are about which guard runs on which path, and that is a property of the
 * hook rather than of this module — asking `sourceLock` on its own would only re-assert the inputs
 * the test itself chose. So the real authored handlers are called, and the double is kept narrow
 * for the reason `payslip-sources-lock.test.ts` keeps its narrow: a broader fake is a second,
 * silently divergent description of the authoring api.
 */
function fakeHookApi({ runs = [], captures = [] } = {}) {
	return {
		db: {
			employments: {
				findFirst: () => Effect.succeed({ company_id: 'co-1' }),
				// `mutate.prepare` asks for the whole batch's employments at once, where the
				// per-record path asked one at a time. The double kept only `findFirst`, so
				// `yield* undefined(...)` threw before any guard ran and the refusal assertion
				// below was passing on a `TypeError`. Same company, stated once for both shapes.
				findMany: ({ where }) =>
					Effect.succeed(
						(where?.id?.in ?? ['emp-1']).map((id) => ({
							id,
							company_id: 'co-1'
						}))
					)
			},
			employment_terms: { findMany: () => Effect.succeed([]) },
			work_days: { findMany: () => Effect.succeed([]) },
			shift_definitions: { findMany: () => Effect.succeed([]) },
			payroll_runs: { findMany: () => Effect.succeed(runs) },
			// A capture is a `payslip_work_day_inputs` junction row naming the day. Its payslip's
			// amount is deliberately not consulted: a zero says the run read this day and priced it
			// at nothing, which locks the record exactly as hard as a row that paid overtime on it.
			payslip_work_day_inputs: {
				findFirst: ({ where }) =>
					Effect.succeed(captures.find((row) => row.work_day_id === where.work_day_id.eq) ?? null)
			},
			// No approved leave anywhere: the leave guard is orthogonal to the payroll locks and
			// keeps its own tests.
			leave_requests: { findMany: () => Effect.succeed([]) }
		}
	};
}

const punch = (overrides = {}) => ({
	id: 'wd-1',
	employment_id: 'emp-1',
	work_date: '2026-07-01',
	approval_id: null,
	worked_intervals: [{ start: '2026-07-01T00:16:00Z', end: '2026-07-01T09:10:00Z' }],
	break_minutes: 60,
	...overrides
});

/** Run the unified mutation hook exactly as the runtime does: prepare once, then decide one row. */
function runMutateBefore({ changes, existing, api }) {
	const input =
		existing == null
			? changes
			: {
					employment_id: existing.employment_id,
					work_date: existing.work_date,
					shift_definition_id: existing.shift_definition_id ?? null,
					worked_intervals: existing.worked_intervals,
					break_minutes: existing.break_minutes,
					...changes,
					id: existing.id
				};
	const prepared = Effect.runSync(workDayHooks.mutate.prepare({ inputs: [input], api }));
	return Effect.runSync(
		workDayHooks.mutate.perRecord.before.handler({ input, existing, prepared, api })
	);
}

test('a create inside a paid window is refused: that day’s silence is already priced', () => {
	const api = fakeHookApi({ runs: monthly });
	// `mutate` is two stages, and the second cannot answer without the first. `prepare` runs once
	// per batch and gathers the employment→company and company→window maps; `perRecord.before`
	// reads them. The helper above deliberately runs both stages through their Effects, so this
	// assertion can only pass on the authored refusal rather than on a stale namespace TypeError.
	const create = (overrides = {}) => {
		const { id: _id, approval_id: _approvalId, ...changes } = punch(overrides);
		return runMutateBefore({ changes, existing: undefined, api });
	};
	assert.throws(() => create(), /inside paid payroll 2026-07/);
	// The same create one window along, where the run is still a draft, lands.
	assert.doesNotThrow(() => create({ work_date: '2026-08-01' }));
});

test('an unconsumed record inside a paid window stays editable and settles as arrears', () => {
	// §2.3, the one open decision, decided. A punch keyed in after 2026-07 was paid: no payslip ever
	// took it, so nothing has been paid on it, so it may be corrected and priced in a later run.
	// The board badges the day; the write path permits it.
	const api = fakeHookApi({ runs: monthly });
	const existing = punch();
	assert.doesNotThrow(() => runMutateBefore({ changes: { break_minutes: 30 }, existing, api }));
	// The window has not stopped meaning anything — asked the day-shaped question it still refuses a
	// record appearing on that day. Two answers, because two questions.
	assert.deepEqual(lockStateForDate(payrollWindows(monthly), '2026-07-01'), {
		kind: 'SETTLED',
		period: '2026-07'
	});
	// A claim over the same record is what refuses, and it names the period.
	const claimed = fakeHookApi({
		runs: monthly,
		captures: [{ work_day_id: 'wd-1', period: '2026-07' }]
	});
	assert.throws(
		() => runMutateBefore({ changes: { break_minutes: 30 }, existing, api: claimed }),
		/payroll 2026-07 has already taken this record into account/
	);
});

test('re-dating a record into a paid window is a create onto that day, and is refused', () => {
	// The create guard would be two writes away from decorative otherwise: record an open day, then
	// move it into the paid period. An in-place edit of the same record is untouched by this.
	const api = fakeHookApi({ runs: monthly });
	assert.throws(
		() =>
			runMutateBefore({
				changes: { work_date: '2026-07-02' },
				existing: punch({ work_date: '2026-08-02' }),
				api
			}),
		/inside paid payroll 2026-07/
	);
	assert.doesNotThrow(() =>
		runMutateBefore({
			changes: { work_date: '2026-08-03' },
			existing: punch({ work_date: '2026-08-02' }),
			api
		})
	);
});

test('a malformed run is skipped rather than locking everything', () => {
	const windows = payrollWindows([
		{
			period: '2026-08',
			lifecycle: 'PAID',
			attendance_from: '2026-08-20',
			attendance_to: '2026-08-01'
		}
	]);
	assert.deepEqual(windows, []);
});
