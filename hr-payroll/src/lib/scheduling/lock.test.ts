// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	payrollWindows,
	lockStateForDate,
	lockMap,
	assertNotSettled,
	sourceLock,
	sourceLockBlocksWrite,
	assertSourceUnlocked
} from './lock.ts';

const monthly = [
	{
		period: '2026-08',
		lifecycle: 'DRAFT',
		attendance_from: '2026-07-21',
		attendance_to: '2026-08-20'
	},
	{
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

test('sourceLock freezes approved live leave and a day that has passed', () => {
	const windows = payrollWindows(monthly);
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-08-25'],
			today: '2026-08-18',
			windows,
			freezeWhenLive: true
		}),
		{ kind: 'APPROVED' }
	);
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-08-10'],
			today: '2026-08-18',
			windows,
			freezeWhenLive: false
		}),
		{ kind: 'DATE_PASSED', date: '2026-08-10' }
	);
	assert.equal(
		sourceLock({
			existing: false,
			dates: ['2026-08-10'],
			today: '2026-08-18',
			windows,
			freezeWhenLive: true
		}).kind,
		'NONE'
	);
});

test('sourceLock prefers payslip consumption and a paid window over a live freeze', () => {
	const windows = payrollWindows(monthly);
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-07-01'],
			today: '2026-08-18',
			windows,
			freezeWhenLive: true
		}),
		{ kind: 'SETTLED', period: '2026-07', date: '2026-07-01' }
	);
	assert.deepEqual(
		sourceLock({
			existing: true,
			dates: ['2026-08-25'],
			today: '2026-08-18',
			windows,
			consumedByPayslip: true,
			freezeWhenLive: true
		}),
		{ kind: 'PAYSLIP_CONSUMED' }
	);
	assert.deepEqual(
		sourceLock({
			existing: true,
			approvalId: 'req-1',
			dates: ['2026-07-01'],
			today: '2026-08-18',
			windows,
			freezeWhenLive: true
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
		() => assertSourceUnlocked({ kind: 'APPROVED' }, 'Changing a leave request'),
		/approved/
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
