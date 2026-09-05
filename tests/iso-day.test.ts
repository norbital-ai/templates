import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey } from '../src/lib/iso-day.ts';
import { requiredDateKey } from '../src/collections/payroll_runs/lib/dates.ts';
import { coversDate } from '../src/collections/payroll_runs/lib/effective.ts';

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
