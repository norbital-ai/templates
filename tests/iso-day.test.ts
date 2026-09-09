import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey } from '../src/lib/iso-day.ts';
import { requiredDateKey } from '../src/collections/payroll_runs/lib/dates.ts';
import { coversDate } from '../src/collections/payroll_runs/lib/effective.ts';
import { formatCalendarDate, formatCalendarInstant } from '../src/lib/ui/display-formatters.ts';

test('hire, attendance and effective dates agree across a UTC day boundary', () => {
	const midnight = '2026-01-19T16:00:00.000Z';
	assert.equal(dateKey(midnight), '2026-01-20');
	assert.equal(requiredDateKey(midnight, 'hire date'), '2026-01-20');
	assert.equal(dateKey('2026-01-20'), '2026-01-20');
	assert.equal(coversDate({ start: midnight, end: midnight }, dateKey(midnight)), true);
	assert.equal(dateKey('2026-01-20T23:59:59+08:00'), '2026-01-20');
	assert.equal(dateKey('2026-01-20T16:00:00Z'), '2026-01-21');
	assert.equal(dateKey('2026-01-20T00:00:00'), '');
	assert.equal(dateKey('not a date'), '');
});

test('a day-precision instant column prints the day it was picked, not the UTC day', () => {
	// `2026-06-30` picked in Kuala Lumpur is stored as the instant below. Slicing it printed
	// 29 Jun on a run's pay date and attendance window while the same row's table cell said 30 Jun.
	assert.equal(formatCalendarInstant('2026-06-29T16:00:00.000Z'), '30 Jun 2026');
	assert.equal(formatCalendarInstant('2026-06-30T00:00:00.000Z'), '30 Jun 2026');
	assert.equal(formatCalendarInstant(null), '—');
	assert.equal(formatCalendarInstant('not a date'), '—');
	// Values a page computed itself are already calendar days and keep their own formatter.
	assert.equal(formatCalendarDate('2026-06-30'), '30 Jun 2026');
});
