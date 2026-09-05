import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceRow } from '../src/collections/leave_requests/$types.js';
import {
	awardedLeaveDays,
	leaveAccountBalance,
	leaveAccountSummary
} from '../src/lib/leave/ledger.js';

type Account = WorkspaceRow<'leave_accounts'>;
type Entry = WorkspaceRow<'leave_entries'>;

const account = {
	id: '10000000-0000-4000-8000-000000000001',
	entitlement_days: 14
} as Account;

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
		entry('POLICY_ADJUSTMENT', 2, '2026-07-01'),
		entry('TAKEN', -1, '2026-10-01')
	];
	assert.equal(leaveAccountBalance(entries, '2026-06-30'), 11);
	assert.equal(leaveAccountBalance(entries, '2026-12-31'), 12);
});

test('target comparisons use awards, never remaining balance after leave taken', () => {
	const entries = [
		entry('OPENING_ENTITLEMENT', 14, '2026-01-01'),
		entry('TAKEN', -8, '2026-03-01'),
		entry('CARRY_FORWARD', 5, '2026-01-01')
	];
	assert.equal(awardedLeaveDays(entries), 14);
});

test('held applications reserve availability without becoming posted movements', () => {
	const summary = leaveAccountSummary({
		account,
		entries: [
			entry('OPENING_ENTITLEMENT', 14, '2026-01-01'),
			entry('CARRY_FORWARD', 3, '2026-01-01'),
			entry('TAKEN', -4, '2026-04-01'),
			entry('RESTORED', 1, '2026-04-01')
		],
		pendingDays: 2,
		asOf: '2026-09-01'
	});
	assert.deepEqual(
		{
			earned: summary.earned,
			carried: summary.carried,
			taken: summary.taken,
			balance: summary.balance,
			available: summary.available
		},
		{ earned: 14, carried: 3, taken: 3, balance: 14, available: 12 }
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
	assert.equal(leaveAccountBalance(oldEntries, '2025-12-31'), 0);
	assert.equal(leaveAccountBalance(nextEntries, '2026-01-01'), 5);
});
