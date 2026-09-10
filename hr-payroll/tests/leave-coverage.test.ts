// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { leaveCoverage } from '../src/lib/scheduling/leave-coverage.ts';

const fullWeek = {
	kind: 'TIME_OFF',
	from_date: '2026-08-03',
	to_date: '2026-08-07',
	half_day_start: false,
	half_day_end: false
};

const halfBoundary = {
	kind: 'TIME_OFF',
	from_date: '2026-08-03',
	to_date: '2026-08-05',
	half_day_start: true,
	half_day_end: true
};

test('a request fully covers its interior days', () => {
	assert.deepEqual(leaveCoverage(fullWeek, '2026-08-04'), { covered: true, fullDay: true });
});

test('the half-day boundary days are only half covered', () => {
	// start half = SECOND: the morning is free; end half = FIRST: the afternoon is free.
	assert.deepEqual(leaveCoverage(halfBoundary, '2026-08-03'), { covered: true, fullDay: false });
	assert.deepEqual(leaveCoverage(halfBoundary, '2026-08-05'), { covered: true, fullDay: false });
	assert.deepEqual(leaveCoverage(halfBoundary, '2026-08-04'), { covered: true, fullDay: true });
});

test('dates outside the range are not covered', () => {
	assert.deepEqual(leaveCoverage(fullWeek, '2026-08-02'), { covered: false, fullDay: false });
	assert.deepEqual(leaveCoverage(fullWeek, '2026-08-08'), { covered: false, fullDay: false });
});

test('full-day coverage needs at least one fully owning request', () => {
	const fullDay = (requests: readonly (typeof fullWeek)[], date: string): boolean =>
		requests.some((request) => leaveCoverage(request, date).fullDay);
	assert.equal(fullDay([fullWeek, halfBoundary], '2026-08-06'), true);
	assert.equal(fullDay([fullWeek], '2026-08-03'), true);
	// Only the half-day request covers the 3rd: half days never block the other half.
	assert.equal(fullDay([halfBoundary], '2026-08-03'), false);
	assert.equal(fullDay([], '2026-08-03'), false);
});
