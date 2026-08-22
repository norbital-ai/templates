// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	distributeRepaymentSchedule,
	monthlyDueDates,
	repaymentScheduleIssues
} from './lib/repayment-schedule.ts';

/** Sum a provisioned schedule in cents and back, for the round-trip invariant. */
function repaymentScheduleTotal(schedule) {
	return schedule.reduce((total, entry) => total + Math.round(entry.amount * 100), 0) / 100;
}

test('equal provisioning preserves the principal exactly in cents', () => {
	const schedule = distributeRepaymentSchedule(2044, monthlyDueDates('2026-01-31', 3));
	assert.deepEqual(schedule, [
		{ due_date: '2026-01-31', amount: 681.33 },
		{ due_date: '2026-02-28', amount: 681.33 },
		{ due_date: '2026-03-31', amount: 681.34 }
	]);
	assert.equal(repaymentScheduleTotal(schedule), 2044);
});

test('a schedule whose amounts do not equal principal is rejected', () => {
	const issues = repaymentScheduleIssues({
		principal: 100,
		effectiveRange: { start: '2026-01-31', end: '2026-02-28' },
		schedule: [
			{ due_date: '2026-01-31', amount: 40 },
			{ due_date: '2026-02-28', amount: 50 }
		]
	});
	assert.ok(issues.some((issue) => issue.includes('100.00 exactly')));
	assert.ok(issues.some((issue) => issue.includes('90.00')));
});

test('a final instalment after the agreement period is rejected', () => {
	const issues = repaymentScheduleIssues({
		principal: 100,
		effectiveRange: { start: '2026-01-31', end: '2026-02-27' },
		schedule: [
			{ due_date: '2026-01-31', amount: 50 },
			{ due_date: '2026-02-28', amount: 50 }
		]
	});
	assert.deepEqual(issues, [
		'The final repayment 2026-02-28 is later than the agreement period ending 2026-02-27.'
	]);
});

test('the agreement period end itself is allowed', () => {
	assert.deepEqual(
		repaymentScheduleIssues({
			principal: 100,
			effectiveRange: { start: '2026-01-31', end: '2026-02-28' },
			schedule: [
				{ due_date: '2026-01-31', amount: 50 },
				{ due_date: '2026-02-28', amount: 50 }
			]
		}),
		[]
	);
});

test('a final instalment before the agreement period start is rejected', () => {
	const issues = repaymentScheduleIssues({
		principal: 100,
		effectiveRange: { start: '2026-03-01', end: '2026-03-31' },
		schedule: [
			{ due_date: '2026-01-31', amount: 50 },
			{ due_date: '2026-02-28', amount: 50 }
		]
	});
	assert.deepEqual(issues, [
		'The final repayment 2026-02-28 is earlier than the agreement period starting 2026-03-01.'
	]);
});

test('an open-ended agreement period does not bound the last due date', () => {
	assert.deepEqual(
		repaymentScheduleIssues({
			principal: 100,
			effectiveRange: { start: '2026-01-31', end: null },
			schedule: [
				{ due_date: '2026-01-31', amount: 50 },
				{ due_date: '2026-02-28', amount: 50 }
			]
		}),
		[]
	);
});

test('dates must be unique and strictly increasing', () => {
	const issues = repaymentScheduleIssues({
		principal: 100,
		effectiveRange: { start: '2026-02-28', end: '2026-03-31' },
		schedule: [
			{ due_date: '2026-02-28', amount: 50 },
			{ due_date: '2026-02-28', amount: 50 }
		]
	});
	assert.ok(issues.includes('Repayment dates must be unique and strictly increasing.'));
});
