// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
/**
 * The attendance write path these locks govern.
 *
 * `time_entries` and `roster_entries` are one collection now, so the transform that refuses a punch on a
 * settled day live on `work_days`. This file owns the lock arithmetic; the cases below are here
 * because a lock nothing enforces is a lock nobody has, and they are the only place the two halves
 * are asserted together.
 */
import {
	payrollWindows,
	dayLockKey,
	lockStateForDate,
	lockMap,
	assertNotSettled,
	sourceLock,
	sourceLockApplicationLocked,
	sourceLockRecordMetadata
} from '../src/lib/scheduling/lock.ts';

/**
 * Two runs of one company, in the shape the real read returns them.
 *
 * `company_id` is not decoration: the transform selects it and groups the windows by it, because
 * company is the key a record can reach on its own (employment → company). Without it every window
 * landed under `undefined`, the lookup for `co-1` found nothing, and the paid-window refusal below
 * silently did not fire — a fixture describing a response the api does not return.
 */
const monthly = [
	{
		id: 'run-08',
		company_id: 'co-1',
		period: '2026-08',
		attendance_from: '2026-07-21',
		attendance_to: '2026-08-20'
	},
	{
		id: 'run-07',
		company_id: 'co-1',
		period: '2026-07',
		attendance_from: '2026-06-21',
		attendance_to: '2026-07-20'
	}
];

/**
 * The payslips those runs hold. July is paid for `emp-1` and held for `emp-2`, which is the case a
 * run-shaped lock could not express at all: it had one answer for a month where one colleague has
 * been paid and another has not.
 */
const monthlySlips = [
	{ payroll_run_id: 'run-07', employment_id: 'emp-1', paid_at: '2026-07-31' },
	{ payroll_run_id: 'run-07', employment_id: 'emp-2', paid_at: null },
	{ payroll_run_id: 'run-08', employment_id: 'emp-1', paid_at: null },
	{ payroll_run_id: 'run-08', employment_id: 'emp-2', paid_at: null }
];

test('windows are derived from every run, and settled per person', () => {
	const windows = payrollWindows(monthly, monthlySlips);
	assert.deepEqual(
		windows.map((window) => [window.start, window.end, window.period, [...window.settledFor]]),
		[
			['2026-07-21', '2026-08-20', '2026-08', []],
			['2026-06-21', '2026-07-20', '2026-07', ['emp-1']]
		]
	);
});

test('a day outside every window is untouched', () => {
	const windows = payrollWindows(monthly, monthlySlips);
	assert.deepEqual(lockStateForDate(windows, '2026-08-21', 'emp-1'), { kind: 'NONE' });
});

test('a day is settled for the person who was paid and open for the one who was not', () => {
	const windows = payrollWindows(monthly, monthlySlips);
	assert.deepEqual(lockStateForDate(windows, '2026-08-01', 'emp-1'), {
		kind: 'IN_WINDOW',
		period: '2026-08'
	});
	assert.deepEqual(lockStateForDate(windows, '2026-07-01', 'emp-1'), {
		kind: 'SETTLED',
		period: '2026-07'
	});
	// The same July day, the same run, the colleague whose payslip is still held.
	assert.deepEqual(lockStateForDate(windows, '2026-07-01', 'emp-2'), {
		kind: 'IN_WINDOW',
		period: '2026-07'
	});
});

test('semi-monthly periods lock the exact half they cover', () => {
	const windows = payrollWindows(
		[
			{
				id: 'half-1',
				period: '2026-08-1',
				attendance_from: '2026-07-21',
				attendance_to: '2026-08-05'
			},
			{
				id: 'half-2',
				period: '2026-08-2',
				attendance_from: '2026-08-06',
				attendance_to: '2026-08-20'
			}
		],
		[{ payroll_run_id: 'half-1', employment_id: 'emp-1', paid_at: '2026-08-05' }]
	);
	assert.deepEqual(lockStateForDate(windows, '2026-08-05', 'emp-1'), {
		kind: 'SETTLED',
		period: '2026-08-1'
	});
	assert.deepEqual(lockStateForDate(windows, '2026-08-06', 'emp-1'), {
		kind: 'IN_WINDOW',
		period: '2026-08-2'
	});
	assert.deepEqual(lockStateForDate(windows, '2026-08-21', 'emp-1'), { kind: 'NONE' });
});

test('lockMap builds one lock per person-day', () => {
	const locks = lockMap(
		payrollWindows(monthly, monthlySlips),
		['2026-06-30', '2026-07-21', '2026-09-01'],
		['emp-1', 'emp-2']
	);
	assert.deepEqual(locks.get(dayLockKey('emp-2', '2026-06-30')), {
		kind: 'IN_WINDOW',
		period: '2026-07'
	});
	assert.deepEqual(
		['2026-06-30', '2026-07-21', '2026-09-01'].map((date) => locks.get(dayLockKey('emp-1', date))),
		[
			{ kind: 'SETTLED', period: '2026-07' },
			{ kind: 'IN_WINDOW', period: '2026-08' },
			{ kind: 'NONE' }
		]
	);
});

test('assertNotSettled refuses a settled day and passes every other state', () => {
	const windows = payrollWindows(monthly, monthlySlips);
	assert.throws(
		() => assertNotSettled(windows, '2026-07-01', 'Changing attendance', 'emp-1'),
		/inside paid payroll 2026-07/
	);
	assert.doesNotThrow(() =>
		assertNotSettled(windows, '2026-08-01', 'Changing attendance', 'emp-1')
	);
	assert.doesNotThrow(() =>
		assertNotSettled(windows, '2026-08-25', 'Changing attendance', 'emp-1')
	);
	// The same day for the colleague whose July payslip is still held: not settled, not refused.
	assert.doesNotThrow(() =>
		assertNotSettled(windows, '2026-07-01', 'Changing attendance', 'emp-2')
	);
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

test('approval and application locks stay explicitly classified', () => {
	const pendingApproval = { kind: 'PENDING_APPROVAL' } as const;
	const settled = { kind: 'SETTLED', period: '2026-07' } as const;
	const unlocked = { kind: 'NONE' } as const;

	assert.equal(sourceLockApplicationLocked(pendingApproval), false);
	assert.equal(sourceLockApplicationLocked(settled), true);
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
 * `docs/scheduling.md` (locking), which is the contract these cover:
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
		assert.equal(sourceLockApplicationLocked(lock), true);
	}
});

test('a malformed run is skipped rather than locking everything', () => {
	const windows = payrollWindows([
		{
			period: '2026-08',
			attendance_from: '2026-08-20',
			attendance_to: '2026-08-01'
		}
	]);
	assert.deepEqual(windows, []);
});
