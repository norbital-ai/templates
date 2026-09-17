import assert from 'node:assert/strict';
import test from 'node:test';
import {
	allocateLeaveDays,
	assertLeaveBalanceIntegrity,
	leaveBalanceAt,
	reverseLeaveAllocations,
	type LeaveBalanceEntry,
	type EntitlementAt
} from '../src/lib/leave/balance.ts';
import type { LeaveWindow } from '../src/lib/leave/entitlement.ts';

const previous = { start: '2026-01-01', end: '2026-12-31' };
const window = { start: '2027-01-01', end: '2027-12-31' };
const carryId = '11111111-1111-4111-8111-111111111111';
const carry: LeaveBalanceEntry = {
	id: carryId,
	approval_id: null,
	from_date: previous.start,
	to_date: previous.end,
	destination_from: window.start,
	destination_to: window.end,
	days: 5,
	available_from: window.start,
	expires_on: '2027-03-31',
	effective_on: '2027-01-15',
	reason: 'Approved transfer',
	// The credit is the entry itself: only the source debit is an allocation.
	allocations: [{ window: previous, date: previous.end, days: -5, credit_entry_id: null }]
};
const entitlement: EntitlementAt = () => ({ available: 12, earned: 12 });
const usage = (
	id: string,
	date: string,
	days: number,
	entries: readonly LeaveBalanceEntry[],
	target: LeaveWindow = window
): LeaveBalanceEntry => ({
	id,
	approval_id: null,
	from_date: date,
	to_date: date,
	half_day_start: false,
	half_day_end: false,
	days,
	reason: null,
	allocations: allocateLeaveDays({
		entries,
		window: target,
		date,
		days,
		entitlementAt: entitlement
	})
});

test('manual carry is read directly in the destination year, with only unused credit expiring', () => {
	assert.equal(
		leaveBalanceAt({ entries: [carry], window, date: window.start, entitlementAt: entitlement })
			.balance,
		17
	);
	const taken = usage('take', '2027-02-01', 3, [carry]);
	assert.deepEqual(
		taken.allocations.map((row) => [row.credit_entry_id, row.days]),
		[[carryId, -3]]
	);
	const before = leaveBalanceAt({
		entries: [carry, taken],
		window,
		date: '2027-03-31',
		entitlementAt: entitlement
	});
	const after = leaveBalanceAt({
		entries: [carry, taken],
		window,
		date: '2027-04-01',
		entitlementAt: entitlement
	});
	assert.equal(before.balance, 14);
	assert.equal(after.balance, 12);
	assert.equal(after.expired, 2);
	assert.equal(
		leaveBalanceAt({
			entries: [carry],
			window: previous,
			date: previous.end,
			entitlementAt: entitlement
		}).balance,
		7,
		'approval in January still consumes the named source window'
	);
});

test('pending carry cannot be spent, while pending usage reserves its approved source credit', () => {
	const pendingCarry = { ...carry, approval_id: 'held' };
	assert.equal(
		leaveBalanceAt({
			entries: [pendingCarry],
			window,
			date: window.start,
			entitlementAt: entitlement
		}).balance,
		12
	);
	const pending = { ...usage('pending', '2027-02-01', 4, [carry]), approval_id: 'held' };
	const view = leaveBalanceAt({
		entries: [carry, pending],
		window,
		date: '2027-02-01',
		entitlementAt: entitlement
	});
	assert.equal(view.balance, 17);
	assert.equal(view.available, 13);
	assert.equal(view.pending, 4);
});

test('an earlier request cannot consume credit already allocated to a future request', () => {
	const future = usage('future', '2027-03-01', 5, [carry]);
	assert.equal(
		leaveBalanceAt({
			entries: [carry, future],
			window,
			date: '2027-02-01',
			entitlementAt: entitlement
		}).available,
		12,
		'the displayed availability must reserve approved future usage too'
	);
	const earlier = usage('earlier', '2027-02-01', 1, [carry, future]);
	assert.equal(earlier.allocations[0]?.credit_entry_id, null);
	assert.throws(() => usage('too-much', '2027-02-02', 13, [carry, future]), /Insufficient leave/);
});

test('encashment validates earned quantities and future commitments', () => {
	const earned: EntitlementAt = (_window, date) => ({
		available: 12,
		earned: Number(date.slice(5, 7))
	});
	assert.throws(
		() =>
			allocateLeaveDays({
				entries: [],
				window,
				date: '2027-06-30',
				days: 7,
				entitlementAt: earned,
				basis: 'earned'
			}),
		/Insufficient leave/
	);
	assert.equal(
		allocateLeaveDays({
			entries: [],
			window,
			date: '2027-06-30',
			days: 6,
			entitlementAt: earned,
			basis: 'earned'
		})[0]?.days,
		-6
	);
});

test('reversing usage restores original credit validity and cannot revive expired carry', () => {
	const taken = usage('take', '2027-02-01', 3, [carry]);
	const reversed: LeaveBalanceEntry = {
		id: 'reversal',
		approval_id: null,
		as_adjustment_entry: true,
		reversal_of_id: carryId,
		effective_on: '2027-04-10',
		due_on: null,
		days: 3,
		reason: 'Correction',
		allocations: reverseLeaveAllocations(taken)
	};
	assert.equal(
		leaveBalanceAt({
			entries: [carry, taken, reversed],
			window,
			date: '2027-04-10',
			entitlementAt: entitlement
		}).balance,
		12
	);
	assert.equal(
		leaveBalanceAt({
			entries: [carry, taken, reversed],
			window,
			date: '2027-04-10',
			entitlementAt: entitlement
		}).expired,
		5
	);
});

test('spent carry cannot be reversed to restore the same days to the source', () => {
	const taken = usage('take', '2027-02-01', 3, [carry]);
	const reversal: LeaveBalanceEntry = {
		id: 'reverse-carry',
		approval_id: null,
		as_adjustment_entry: true,
		reversal_of_id: carryId,
		effective_on: '2027-02-02',
		due_on: null,
		days: 5,
		reason: 'Correction',
		allocations: reverseLeaveAllocations(carry)
	};
	assert.doesNotThrow(() =>
		assertLeaveBalanceIntegrity([carry, reversal], [previous, window], entitlement)
	);
	assert.throws(
		() => assertLeaveBalanceIntegrity([carry, taken, reversal], [previous, window], entitlement),
		/overdrawn/
	);
});
