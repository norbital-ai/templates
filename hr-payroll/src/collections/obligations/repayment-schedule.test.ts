// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Provisioning a SCHEDULED obligation's instalments.
 *
 * Moved here from `repayment_agreements` unchanged in its arithmetic and retyped to
 * `ObligationInstalment`. What did **not** move is `repaymentScheduleIssues`: validating an
 * obligation belongs to `obligationTermsIssues` in `src/lib/obligation_refusals.ts`, and a second
 * validator over the same columns is a second chance for the two to disagree. The tests that drove
 * it are gone with it, and the ceiling they were partly standing in for is now
 * `OBLIGATION_OVER_CONSUMED` — see `repayment-consumption.test.ts` beside this file.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { distributeRepaymentSchedule, monthlyDueDates } from './lib/repayment-schedule.ts';

/** Sum a provisioned schedule in cents and back, for the round-trip invariant. */
function scheduleTotal(instalments) {
	return instalments.reduce((total, entry) => total + Math.round(entry.amount * 100), 0) / 100;
}

test('equal provisioning preserves the principal exactly in cents', () => {
	const instalments = distributeRepaymentSchedule(2044, monthlyDueDates('2026-01-31', 3));
	assert.deepEqual(instalments, [
		{ due_date: '2026-01-31', amount: 681.33 },
		{ due_date: '2026-02-28', amount: 681.33 },
		{ due_date: '2026-03-31', amount: 681.34 }
	]);
	assert.equal(scheduleTotal(instalments), 2044);
});

test('a monthly date keeps its day, or the target month’s last day where there is none', () => {
	assert.deepEqual(monthlyDueDates('2026-01-31', 4), [
		'2026-01-31',
		'2026-02-28',
		'2026-03-31',
		'2026-04-30'
	]);
	// And it does not drift: February's clamp never carries into March.
	assert.deepEqual(monthlyDueDates('2026-11-30', 3), ['2026-11-30', '2026-12-30', '2027-01-30']);
});

test('the instalment carries no sequence, because its number is its position', () => {
	// `agreement_instalments` and the `LOAN_INSTALMENT` rows that pointed at it were both a second
	// copy of the array index, and the two could disagree. There is one place the order is written
	// down now, and this is the shape that says so.
	for (const instalment of distributeRepaymentSchedule(300, monthlyDueDates('2026-01-01', 3))) {
		assert.deepEqual(Object.keys(instalment).toSorted(), ['amount', 'due_date']);
	}
});

test('a principal that cannot make every instalment a cent is refused', () => {
	assert.throws(
		() => distributeRepaymentSchedule(0.02, monthlyDueDates('2026-01-01', 3)),
		/at least 0\.01/
	);
	assert.throws(() => distributeRepaymentSchedule(0, ['2026-01-01']), /must be positive/);
	assert.throws(() => distributeRepaymentSchedule(10.005, ['2026-01-01']), /whole cents/);
});

test('the count is bounded at both ends, and the bound is the schema’s own', () => {
	assert.throws(() => monthlyDueDates('2026-01-01', 0), /between 1 and 600/);
	assert.throws(() => monthlyDueDates('2026-01-01', 601), /between 1 and 600/);
	assert.equal(monthlyDueDates('2026-01-01', 600).length, 600);
});
