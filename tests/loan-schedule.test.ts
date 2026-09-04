// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createLoanRepaymentDraft,
	loanScheduleFromRows,
	loanScheduleImbalanced,
	loanScheduleTotal,
	loanScheduleWriteRows
} from '../src/lib/loan-schedule.ts';

test('sums amount_due without rewriting rows', () => {
	const rows = [{ amount_due: 400.5 }, { amount_due: 400 }, { amount_due: 399.5 }];
	assert.equal(loanScheduleTotal(rows), 1200);
	assert.deepEqual(
		rows.map((row) => row.amount_due),
		[400.5, 400, 399.5]
	);
});

test('flags a schedule that does not match principal and leaves the draft alone', () => {
	const rows = [
		{ id: 'a', due_date: '2026-01-15', amount_due: 500, sequence: 1 },
		{ id: 'b', due_date: '2026-02-15', amount_due: 500, sequence: 2 }
	];
	assert.equal(loanScheduleImbalanced(1200, rows), true);
	assert.equal(loanScheduleImbalanced(1000, rows), false);
	assert.equal(rows[0]?.amount_due, 500);
	assert.equal(rows[1]?.amount_due, 500);
});

test('keeps authored amounts on write and assigns a new line after the last sequence', () => {
	const stored = loanScheduleFromRows([
		{ id: 'r1', due_date: '2026-01-15', amount_due: 700, sequence: 1 }
	]);
	const next = createLoanRepaymentDraft(stored[0]);
	assert.equal(next.sequence, 2);
	assert.equal(next.amount_due, null);
	assert.deepEqual(loanScheduleWriteRows([...stored, next]), [
		{ id: 'r1', due_date: '2026-01-15', amount_due: 700, sequence: 1 },
		{ id: next.id, sequence: 2 }
	]);
});
