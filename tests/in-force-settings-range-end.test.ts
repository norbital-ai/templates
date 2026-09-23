/**
 * A closed employment's exit facts are read against the settings version in force on its last day.
 *
 * `contract-detail.svelte` hands the exit-facts renderer the employment's raw `effective_range`
 * end, which the seed bank stores as the last millisecond of the day in the payroll zone
 * (`endOfDayInstant`). `inForceSettings` fed that straight to `dayInstant`, which throws on
 * anything but `YYYY-MM-DD` — and Employee Self-Service died on load for every opssg employee.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readRange } from '../src/collections/payroll_runs/lib/effective.ts';
import { inForceSettings } from '../src/lib/ui/settings-scope.ts';

test('inForceSettings reads a closed range end as its business day', () => {
	const lastDay = readRange({ start: '2024-01-01', end: '2030-12-31T15:59:59.999Z' })?.end;
	assert.equal(lastDay, '2030-12-31T15:59:59.999Z');
	assert.deepEqual(inForceSettings('SG-opssg', lastDay!).effective_range, {
		contains_date: '2030-12-31T00:00:00.000Z'
	});
	assert.deepEqual(inForceSettings('SG-opssg', '2030-12-31').effective_range, {
		contains_date: '2030-12-31T00:00:00.000Z'
	});
});
