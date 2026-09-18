import assert from 'node:assert/strict';
import test from 'node:test';
import { withPendingLeaveEntries } from '../src/lib/leave/pending.ts';
import {
	planLeaveBatch,
	approve,
	annualWindow,
	id,
	leaveContext,
	submission,
	timeOff
} from './helpers/manual-leave-context.ts';
import type { LeaveContext } from '../src/lib/leave/context.ts';
import type { LeaveSubmission } from '../src/lib/leave/activity.ts';

const before = (context: LeaveContext, inputs: readonly LeaveSubmission[], index = 0) =>
	planLeaveBatch(context, inputs)[index]!;

test('a same-contract batch reserves all debits before any single entry can commit', () => {
	const context = leaveContext();
	const inputs = [
		submission(timeOff('2026-04-01', '2026-04-07'), 'A'),
		submission(timeOff('2026-05-01', '2026-05-06'), 'B')
	];
	for (const index of [0, 1])
		assert.throws(() => before(context, inputs, index), /Insufficient leave/);
	assert.deepEqual(
		context.entries,
		[],
		'failed planning never mutates prepared or stored activity'
	);
});

test('opposite halves coexist in a batch but repeated halves are refused', () => {
	const context = leaveContext();
	const half = (value: 'FIRST' | 'SECOND') => ({
		from_date: '2026-04-01',
		to_date: '2026-04-01',
		half_day_start: value === 'SECOND',
		half_day_end: value === 'FIRST',
		days: null,
		reason: null
	});
	const inputs = [submission(half('FIRST'), 'A'), submission(half('SECOND'), 'B')];
	assert.equal(before(context, inputs, 0).charges[0]?.days, 0.5);
	assert.equal(before(context, inputs, 1).charges[0]?.days, 0.5);
	assert.throws(() => before(context, [inputs[0]!, submission(half('FIRST'), 'B')]), /overlaps/);
});

test('a pending credit in the same batch cannot fund another transaction', () => {
	const context = leaveContext();
	const credit = submission(
		{
			from_date: annualWindow.start,
			to_date: annualWindow.end,
			days: 2,
			effective_on: '2026-01-01',
			reason: 'Additional grant'
		},
		'CREDIT'
	);
	const debit = submission(timeOff('2026-04-01', '2026-04-13'), 'DEBIT');
	for (const inputs of [
		[credit, debit],
		[debit, credit]
	])
		assert.throws(() => before(context, inputs), /Insufficient leave/);
	assert.deepEqual(context.entries, []);
});

test('duplicate references are refused both within a batch and against held activity', () => {
	const context = leaveContext();
	assert.throws(
		() => before(context, [submission(timeOff('2026-04-01')), submission(timeOff('2026-04-02'))]),
		/own reference/
	);
	const held = approve(context, timeOff('2026-04-01'));
	context.entries[0] = { ...held, approval_id: id(200) };
	assert.throws(
		() => before(context, [submission(timeOff('2026-05-01'), held.reference)]),
		/already posted or awaiting approval/
	);
});

test('a batch does not spend another contract’s balance even for the same employee profile', () => {
	const context = leaveContext();
	context.companies.push({ ...context.companies[0]!, id: id(40) });
	context.employments.push({ ...context.employments[0]!, id: id(30), company_id: id(40) });
	context.terms.push({
		...context.terms[0]!,
		id: id(31),
		employment_id: id(30),
		shift_pattern_id: id(42)
	});
	context.shifts.push({ ...context.shifts[0]!, id: id(41), company_id: id(40) });
	context.patterns.push({
		...context.patterns[0]!,
		id: id(42),
		pattern: { days: [{ roster_code_id: id(41) }] }
	});
	const first = submission(timeOff('2026-04-01', '2026-04-12'), 'SAME-REFERENCE');
	const second = {
		...submission(timeOff('2026-04-01', '2026-04-12'), 'SAME-REFERENCE'),
		employment_id: id(30)
	};
	assert.equal(
		before(context, [first, second], 0).allocations.reduce((sum, row) => sum + row.days, 0),
		-12
	);
	assert.equal(
		before(context, [first, second], 1).allocations.reduce((sum, row) => sum + row.days, 0),
		-12
	);
});

test('held proposals reserve the debits they measured and never read as settled', () => {
	const context = leaveContext();
	const proposed = {
		...approve(context, timeOff('2026-04-01')),
		approval_id: id(200),
		payslip_id: 'slip'
	};
	const entries = withPendingLeaveEntries([proposed], []);
	assert.equal(entries[0]?.approval_id, id(200));
	assert.equal(entries[0]?.payslip_id, null);
	assert.deepEqual(entries[0]?.allocations, proposed.allocations);
	assert.deepEqual(withPendingLeaveEntries([], []), []);
});

test('a truncated pending read refuses instead of overstating availability', () => {
	const held = { id: id(10), approval_id: id(200), employment_id: id(1) };
	assert.throws(
		() => withPendingLeaveEntries(Array.from({ length: 2000 }, () => held) as never, []),
		/safety ceiling/
	);
});
