// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	leaveCalendarGrid,
	leaveCalendarGridBounds,
	calendarDaysThrough
} from '../src/lib/leave/calendar-grid.ts';

test('April 2026 grid is Monday-first and 42 days, spilling into March and May', () => {
	const days = leaveCalendarGrid('2026-04');
	assert.equal(days.length, 42);
	assert.equal(days[0], '2026-03-30');
	assert.equal(days[41], '2026-05-10');
	const bounds = leaveCalendarGridBounds('2026-04');
	assert.deepEqual(bounds, { start: '2026-03-30', end: '2026-05-10' });
	assert.equal(new Date(`${days[0]}T00:00:00.000Z`).getUTCDay(), 1);
});

test('calendarDaysThrough is inclusive', () => {
	assert.deepEqual(calendarDaysThrough('2026-04-15', '2026-04-17'), [
		'2026-04-15',
		'2026-04-16',
		'2026-04-17'
	]);
	assert.deepEqual(calendarDaysThrough('2026-04-17', '2026-04-15'), []);
});
