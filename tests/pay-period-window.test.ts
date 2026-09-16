// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPayPeriod, payPeriodWindow } from '../src/collections/payroll_runs/lib/period.ts';

test('the pay-period window is the inverse of the default cutoff rule', () => {
	// The cutoff day opens the window, for entries as for attendance: Nihon's 21st.
	const monthly = { pay_frequency: 'MONTHLY', pay_cutoff_day: 21 };
	assert.deepEqual(payPeriodWindow('2026-03', monthly), { start: '2026-02-21', end: '2026-03-20' });
	for (const date of ['2026-02-21', '2026-03-01', '2026-03-20'])
		assert.equal(defaultPayPeriod(date, 21), '2026-03', date);
	assert.equal(defaultPayPeriod('2026-03-21', 21), '2026-04');
	// A calendar-month entity opens on the 1st.
	assert.deepEqual(payPeriodWindow('2026-02', { pay_frequency: 'MONTHLY', pay_cutoff_day: 1 }), {
		start: '2026-02-01',
		end: '2026-02-28'
	});
	const semi = { pay_frequency: 'SEMI_MONTHLY', pay_cutoff_day: 31 };
	assert.deepEqual(payPeriodWindow('2026-02-1', semi), { start: '2026-02-01', end: '2026-02-15' });
	assert.deepEqual(payPeriodWindow('2026-02-2', semi), { start: '2026-02-16', end: '2026-02-28' });
});
