/** A shift pattern's cycle places any calendar date: day 1 is the day its effective range opens. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cycleDayOn, cycleDays } from '../src/lib/payroll_engine/shift_pattern.ts';

const day = (id: string) => ({ roster_code_id: id });

test('a 7-day week repeats from the day its range opens', () => {
	const days = [day('A'), day('B'), day('C'), day('D'), day('OFF'), day('OFF'), day('REST')];
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-03-02')?.roster_code_id, 'A');
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-03-06')?.roster_code_id, 'OFF');
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-03-08')?.roster_code_id, 'REST');
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-03-09')?.roster_code_id, 'A');
	// 2026-04-20 is 49 days on, so it lands back on day one of the cycle.
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-04-20')?.roster_code_id, 'A');
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-04-22')?.roster_code_id, 'C');
});

test('a 4-day two-on-two-off places days the week cannot', () => {
	const days = [day('DAY'), day('DAY'), day('OFF'), day('OFF')];
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-03-03')?.roster_code_id, 'DAY');
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-03-04')?.roster_code_id, 'OFF');
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-03-06')?.roster_code_id, 'DAY');
	assert.equal(cycleDayOn(days, '2026-03-02', '2026-03-09')?.roster_code_id, 'OFF');
});

test('a date before the anchor, an empty cycle and a malformed field place nothing', () => {
	assert.equal(cycleDayOn([day('A')], '2026-03-02', '2026-03-01'), null);
	assert.equal(cycleDayOn([], '2026-03-02', '2026-03-02'), null);
	assert.deepEqual(cycleDays(null), []);
	assert.deepEqual(cycleDays({ days: 'nope' }), []);
	// A malformed day fails the whole list rather than being skipped: a stored cycle is either readable or not.
	assert.deepEqual(cycleDays({ days: [day('A'), 7, day('B')] }), []);
	assert.equal(cycleDays({ days: [day('A'), day('B')] }).length, 2);
});
