import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceRow } from '../src/collections/leave_requests/$types.js';
import { awardedLeaveDays, leaveBalance, leaveBalanceSummary } from '../src/lib/leave/ledger.js';

type Entitlement = WorkspaceRow<'leave_entitlements'>;
type Entry = WorkspaceRow<'leave_entries'>;

const entitlement = {
	id: '10000000-0000-4000-8000-000000000001',
	entitlement_days: 14
} as Entitlement;

function entry(kind: Entry['kind'], days: number, effectiveOn: string): Entry {
	return {
		id: `${kind}:${effectiveOn}:${days}`,
		kind,
		days,
		effective_on: effectiveOn,
		approval_id: null
	} as Entry;
}

test('balance is the signed posted ledger through the requested date', () => {
	const entries = [
		entry('OPENING_ENTITLEMENT', 14, '2026-01-01'),
		entry('TAKEN', -3, '2026-03-01'),
		entry('ADJUSTMENT', 2, '2026-07-01'),
		entry('TAKEN', -1, '2026-10-01')
	];
	assert.equal(leaveBalance(entries, '2026-06-30'), 11);
	assert.equal(leaveBalance(entries, '2026-12-31'), 12);
});

test('target comparisons use awards through the date, never remaining balance after leave taken', () => {
	const entries = [
		entry('OPENING_ENTITLEMENT', 14, '2026-01-01'),
		entry('TAKEN', -8, '2026-03-01'),
		entry('CARRY_FORWARD', 5, '2026-01-01'),
		entry('ADJUSTMENT', 2, '2026-09-01')
	];
	assert.equal(awardedLeaveDays(entries), 16);
	assert.equal(awardedLeaveDays(entries, '2026-06-30'), 14);
});

test('held applications reserve availability without becoming posted movements', () => {
	const summary = leaveBalanceSummary({
		entitlement,
		entries: [
			entry('OPENING_ENTITLEMENT', 14, '2026-01-01'),
			entry('CARRY_FORWARD', 3, '2026-01-01'),
			entry('TAKEN', -4, '2026-04-01'),
			entry('RESTORED', 1, '2026-04-01'),
			entry('MANUAL_ADJUSTMENT', -2, '2026-05-01')
		],
		pendingDays: 2,
		asOf: '2026-09-01'
	});
	assert.deepEqual(
		{
			entitlement: summary.entitlement,
			earned: summary.earned,
			carried: summary.carried,
			adjusted: summary.adjusted,
			taken: summary.taken,
			balance: summary.balance,
			available: summary.available
		},
		{ entitlement: 12, earned: 14, carried: 3, adjusted: -2, taken: 3, balance: 12, available: 10 }
	);
});

test('carry transfer arithmetic closes the old balance without duplication', () => {
	const oldEntries = [
		entry('OPENING_ENTITLEMENT', 14, '2025-01-01'),
		entry('TAKEN', -8, '2025-06-01'),
		entry('CARRY_TRANSFER_OUT', -5, '2025-12-31'),
		entry('EXPIRED', -1, '2025-12-31')
	];
	const nextEntries = [entry('CARRY_FORWARD', 5, '2026-01-01')];
	assert.equal(leaveBalance(oldEntries, '2025-12-31'), 0);
	assert.equal(leaveBalance(nextEntries, '2026-01-01'), 5);
});
