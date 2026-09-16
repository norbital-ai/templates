// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPayPeriod, payPeriodWindow } from '../src/collections/payroll_runs/lib/period.ts';

test('the pay-period window is the inverse of the default cutoff rule', () => {
	const monthly = { pay_frequency: 'MONTHLY', pay_cutoff_day: 20 };
	assert.deepEqual(payPeriodWindow('2026-03', monthly), { start: '2026-02-21', end: '2026-03-20' });
	for (const date of ['2026-02-21', '2026-03-01', '2026-03-20'])
		assert.equal(defaultPayPeriod(date, 20), '2026-03', date);
	assert.equal(defaultPayPeriod('2026-03-21', 20), '2026-04');
	// A cutoff past a short month's end clamps, so February closes on the 28th.
	assert.deepEqual(payPeriodWindow('2026-02', { pay_frequency: 'MONTHLY', pay_cutoff_day: 31 }), {
		start: '2026-02-01',
		end: '2026-02-28'
	});
	const semi = { pay_frequency: 'SEMI_MONTHLY', pay_cutoff_day: 31 };
	assert.deepEqual(payPeriodWindow('2026-02-1', semi), { start: '2026-02-01', end: '2026-02-15' });
	assert.deepEqual(payPeriodWindow('2026-02-2', semi), { start: '2026-02-16', end: '2026-02-28' });
});
