import assert from 'node:assert/strict';
import test from 'node:test';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import {
	approve,
	id,
	leaveContext,
	timeOff,
	annualWindow
} from './helpers/manual-leave-context.ts';

test('the balance query computes a new year without creating annual account or opening entries', () => {
	const context = leaveContext();
	const before = structuredClone(context);
	for (const asOf of ['2026-01-01', '2027-01-01']) {
		const [balance] = leaveBalanceSummaries(context, id(1), asOf);
		assert.equal(balance?.entitlement, 12);
		assert.equal(balance?.balance, 12);
		assert.equal(balance?.window.start, asOf);
	}
	assert.deepEqual(context, before, 'computing a balance has no writes');
});

test('approved and pending future time off reserve availability without rewriting earned entitlement', () => {
	const context = leaveContext();
	approve(context, timeOff('2026-04-01', '2026-04-04'));
	approve(context, timeOff('2026-10-01', '2026-10-03'), 11);
	const held = approve(context, timeOff('2026-11-01', '2026-11-02'), 12);
	context.entries[2] = { ...held, approval_id: id(100) };
	const [balance] = leaveBalanceSummaries(context, id(1), '2026-06-01');
	assert.deepEqual(
		[balance?.entitlement, balance?.earned, balance?.balance, balance?.available, balance?.pending],
		[12, 12, 8, 3, 2]
	);
});

test('a manual carry entry debits its source year and supplies expiring credit to the next year', () => {
	const context = leaveContext();
	approve(context, timeOff('2026-06-01', '2026-06-08'));
	approve(
		context,
		{
			kind: 'CARRY_FORWARD',
			source_window: annualWindow,
			destination_window: { start: '2027-01-01', end: '2027-12-31' },
			days: 3,
			available_from: '2027-01-01',
			expires_on: '2027-03-31',
			effective_on: '2027-01-15',
			reason: 'HR-approved transfer'
		},
		11
	);
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-12-31')[0]?.balance, 1);
	assert.equal(leaveBalanceSummaries(context, id(1), '2027-01-01')[0]?.balance, 15);
	const [expired] = leaveBalanceSummaries(context, id(1), '2027-04-01');
	assert.equal(expired?.balance, 12);
	assert.equal(expired?.expired, 3);
});

test('unlimited leave reports no finite balance ceiling while preserving usage evidence', () => {
	const context = leaveContext();
	context.catalogues[0]!.entitlement = {
		availability: 'UNLIMITED',
		proration: 'NONE',
		year_start_month: 1,
		bands: []
	};
	approve(context, timeOff('2026-04-01', '2026-04-20'));
	const [balance] = leaveBalanceSummaries(context, id(1), '2026-04-30');
	assert.deepEqual(
		[balance?.entitlement, balance?.earned, balance?.balance, balance?.available],
		[null, null, null, null]
	);
	assert.equal(context.entries[0]?.charges.length, 20);
});
