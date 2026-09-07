// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canGenerateLoanSchedule,
	createLoanRepaymentDraft,
	generateLoanSchedule,
	loanInstalmentDays,
	loanScheduleFromRows,
	loanScheduleImbalanced,
	loanScheduleOrdered,
	loanScheduleTotal,
	loanScheduleWriteRows,
	repaymentProgress
} from '../src/lib/loan-schedule.ts';
import { repaymentOutstanding } from '../src/collections/payroll_runs/lib/entries.ts';

const range = (start, end) => ({ start: `${start}T00:00:00.000Z`, end: `${end}T00:00:00.000Z` });
const day = (value) => value.slice(0, 10);

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

test('the plan is its date order: sequence is renumbered from the dates, never from typing order', () => {
	const typed = [
		{ id: 'c', due_date: '2026-03-01', amount_due: 100, sequence: 1 },
		{ id: 'a', due_date: '2026-01-01', amount_due: 100, sequence: 2 },
		{ id: 'b', due_date: '2026-02-01', amount_due: 100, sequence: 3 }
	];
	assert.deepEqual(
		loanScheduleOrdered(typed).map((row) => [row.id, row.sequence]),
		[
			['a', 1],
			['b', 2],
			['c', 3]
		]
	);
	assert.deepEqual(
		loanScheduleWriteRows(typed).map((row) => row.sequence),
		[1, 2, 3]
	);
});

test('a line with no date yet stays at the bottom in the order it was added', () => {
	const first = createLoanRepaymentDraft();
	const second = createLoanRepaymentDraft(first);
	const ordered = loanScheduleOrdered([
		first,
		{ id: 'dated', due_date: '2026-01-01', amount_due: 10, sequence: 9 },
		second
	]);
	assert.deepEqual(
		ordered.map((row) => row.id),
		['dated', first.id, second.id]
	);
});

test('instalment days are the period start and the same day each following month, inside the period', () => {
	assert.deepEqual(loanInstalmentDays(range('2026-04-01', '2026-09-01')).map(day), [
		'2026-04-01',
		'2026-05-01',
		'2026-06-01',
		'2026-07-01',
		'2026-08-01',
		'2026-09-01'
	]);
	// A short month clamps rather than rolling into the next one.
	assert.deepEqual(loanInstalmentDays(range('2026-01-31', '2026-03-31')).map(day), [
		'2026-01-31',
		'2026-02-28',
		'2026-03-31'
	]);
	// An open-ended agreement does not say how many instalments it has.
	assert.deepEqual(loanInstalmentDays({ start: '2026-04-01T00:00:00.000Z', end: null }), []);
	assert.deepEqual(loanInstalmentDays(null), []);
});

test('generation spreads the principal in whole units and puts the remainder on the last line', () => {
	const generated = generateLoanSchedule({
		principal: 1000,
		range: range('2026-04-01', '2026-09-01'),
		rows: [],
		lockedIds: new Set()
	});
	assert.deepEqual(
		generated.map((row) => row.amount_due),
		[167, 167, 167, 167, 167, 165]
	);
	assert.equal(loanScheduleTotal(generated), 1000);
	assert.deepEqual(
		generated.map((row) => row.sequence),
		[1, 2, 3, 4, 5, 6]
	);
	assert.ok(
		generated.every((row) => Number.isInteger(row.amount_due)),
		'every instalment is a whole currency unit'
	);
	assert.equal(loanScheduleImbalanced(1000, generated), false);
});

test('regeneration keeps existing ids and never rewrites a repayment a payslip already took', () => {
	const stored = loanScheduleFromRows([
		{ id: 'r1', due_date: '2026-04-01T00:00:00.000Z', amount_due: 400, sequence: 1 },
		{ id: 'r2', due_date: '2026-05-01T00:00:00.000Z', amount_due: 300, sequence: 2 },
		{ id: 'r3', due_date: '2026-06-01T00:00:00.000Z', amount_due: 300, sequence: 3 }
	]);
	const regenerated = generateLoanSchedule({
		principal: 1000,
		range: range('2026-04-01', '2026-06-01'),
		rows: stored,
		lockedIds: new Set(['r1'])
	});
	// The captured line is untouched, in place.
	assert.deepEqual(regenerated[0], {
		id: 'r1',
		due_date: '2026-04-01T00:00:00.000Z',
		amount_due: 400,
		sequence: 1
	});
	// The residual, not the principal, is spread over what is left — and the ids are reused.
	assert.deepEqual(
		regenerated.slice(1).map((row) => [row.id, row.amount_due]),
		[
			['r2', 300],
			['r3', 300]
		]
	);
	assert.equal(loanScheduleTotal(regenerated), 1000);
});

test('a fully captured schedule regenerates to itself rather than being rewritten', () => {
	const stored = loanScheduleFromRows([
		{ id: 'r1', due_date: '2026-04-01T00:00:00.000Z', amount_due: 500, sequence: 1 },
		{ id: 'r2', due_date: '2026-05-01T00:00:00.000Z', amount_due: 500, sequence: 2 }
	]);
	assert.deepEqual(
		generateLoanSchedule({
			principal: 1000,
			range: range('2026-04-01', '2026-05-01'),
			rows: stored,
			lockedIds: new Set(['r1', 'r2'])
		}),
		stored
	);
});

test('the generate action is offered only when it has something to do', () => {
	const period = range('2026-04-01', '2026-09-01');
	const balanced = [{ amount_due: 1000 }];
	assert.equal(canGenerateLoanSchedule(1000, period, []), true);
	// Already adds up: the operator's own amounts are not silently replaced.
	assert.equal(canGenerateLoanSchedule(1000, period, balanced), false);
	// Nothing to divide, or nothing to divide it across.
	assert.equal(canGenerateLoanSchedule(null, period, []), false);
	assert.equal(canGenerateLoanSchedule(0, period, []), false);
	assert.equal(
		canGenerateLoanSchedule(1000, { start: '2026-04-01T00:00:00.000Z', end: null }, []),
		false
	);
});

/**
 * How far a schedule has been recovered — what the loans page shows, moved out of the page and
 * driven directly. It was unexported and untested, which is how "paid 3 of 6" could have been wrong
 * for a year without anything noticing.
 */
test('progress is the plan against what paid runs took', () => {
	const schedule = [
		{ amount_due: 250 },
		{ amount_due: 250 },
		{ amount_due: 250 },
		{ amount_due: 250 }
	];
	assert.deepEqual(repaymentProgress(schedule, 0), {
		recoveredAmount: 0,
		outstandingAmount: 1000,
		paidRepayments: 0,
		totalRepayments: 4,
		settled: false
	});
	assert.deepEqual(repaymentProgress(schedule, 500), {
		recoveredAmount: 500,
		outstandingAmount: 500,
		paidRepayments: 2,
		totalRepayments: 4,
		settled: false
	});
	assert.deepEqual(repaymentProgress(schedule, 1000), {
		recoveredAmount: 1000,
		outstandingAmount: 0,
		paidRepayments: 4,
		totalRepayments: 4,
		settled: true
	});
	// Nothing to report about a plan with no rows to report on.
	assert.equal(repaymentProgress([], 0)?.totalRepayments, 0);
});

/**
 * A partially recovered repayment is not a paid one. Net-pay protection can take part of an
 * instalment and leave the rest for the next run, and counting it as settled would report a loan
 * further along than the money is.
 */
test('a part-recovered repayment reads as outstanding, not as paid', () => {
	const schedule = [{ amount_due: 250 }, { amount_due: 250 }];
	const progress = repaymentProgress(schedule, 380);
	assert.equal(progress.paidRepayments, 1);
	assert.equal(progress.outstandingAmount, 120);
	assert.equal(progress.settled, false);
});

/**
 * The page's derivation and the engine's answer to the same question agree.
 *
 * `repaymentOutstanding` is per repayment — `due - taken`, floored at zero, with `taken` capped at
 * the amount due. Summed across the plan in recovery order it is exactly the page's
 * `outstandingAmount`, and the count of repayments it leaves nothing outstanding on is exactly
 * `paidRepayments`. If these ever disagree, one of the two is lying to somebody about a loan.
 */
test('progress agrees with the engine’s per-repayment outstanding', () => {
	const schedule = [
		{ amount_due: 250 },
		{ amount_due: 250 },
		{ amount_due: 250 },
		{ amount_due: 250 }
	];
	for (const recovered of [0, 120, 250, 380, 500, 1000]) {
		const progress = repaymentProgress(schedule, recovered);
		let remaining = recovered;
		let outstanding = 0;
		let settledRows = 0;
		for (const repayment of schedule) {
			const consumed = Math.min(remaining, repayment.amount_due);
			remaining -= consumed;
			const left = repaymentOutstanding(repayment, consumed);
			outstanding += left;
			if (left === 0) settledRows += 1;
		}
		assert.equal(progress.outstandingAmount, outstanding, `outstanding at ${recovered}`);
		assert.equal(progress.paidRepayments, settledRows, `paid count at ${recovered}`);
	}
});
