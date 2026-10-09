/** The run-create picker and the event pages read the effective-dated pay schedule. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { periodIn, periodOptions } from '../src/lib/ui/payroll/pay_periods.ts';

// semi-monthly until 15 March 2026, monthly from the 16th
const entity = {
	pay_frequency: 'SEMI_MONTHLY',
	pay_frequency_changes: [{ from: '2026-03-16', frequency: 'MONTHLY' }],
	pay_cutoff_day: 0
};

test('a month that switches offers each frequency its own periods over its own days', () => {
	const offered = periodOptions(entity, '2026-04-10', 3);
	assert.deepEqual(
		offered.map((row) => [row.key, row.from, row.to]),
		[
			['2026-04', '2026-04-01', '2026-04-30'],
			['2026-03-1', '2026-03-01', '2026-03-15'],
			['2026-03', '2026-03-16', '2026-03-31'],
			['2026-02-1', '2026-02-01', '2026-02-15'],
			['2026-02-2', '2026-02-16', '2026-02-28']
		]
	);
	// nothing that starts after today
	assert.ok(!periodOptions(entity, '2026-03-10', 1).some((row) => row.key === '2026-03'));
});

test('an event page steps by the period the schedule then pays', () => {
	assert.equal(periodIn(entity, '2026-03-1', '2026-04-10')?.key, '2026-03-1');
	assert.equal(periodIn(entity, '2026-03', '2026-03-20')?.key, '2026-03');
	// a key the month does not offer is restated as the period holding today
	assert.equal(periodIn(entity, '2026-03-2', '2026-03-20')?.key, '2026-03');
	assert.deepEqual(periodIn(entity, '2026-03', '2026-03-20')?.window, {
		from: '2026-03-16',
		to: '2026-03-31'
	});
	assert.equal(periodIn(entity, '2026-02', '2026-02-20')?.key, '2026-02-2');
});
