// Figures a formula needs by month live in the balance, keyed by pay month, and leave by dated entries.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { viewOf } from '../../src/lib/ledger/core.ts';
import { payslipWanted } from '../../src/lib/ledger/service.ts';

describe('a month balance', () => {
	const slip = { checkpoints: [{ code: 'BASE', value: 1000 }], statutory: [] };
	const subject = { scope: 'XX', started: '2025-01-01', events: [], taxYearStart: 1 };
	it('holds what the jurisdiction names under the pay month, beside the year', () => {
		const wanted = payslipWanted(slip, '2026-03-25', { ...subject, byMonth: ['BASE'] });
		assert.deepEqual(
			wanted.map((row) => [row.account, row.code, row.period, row.amount]),
			[
				['pay', 'BASE', 'XX.Y.2026-01-01', 1000],
				['pay', 'BASE', 'XX.M.2026-03-01', 1000]
			]
		);
	});
	it('holds only the year for what it does not name', () => {
		const wanted = payslipWanted(slip, '2026-03-25', { ...subject, byMonth: [] });
		assert.deepEqual(
			wanted.map((row) => row.period),
			['XX.Y.2026-01-01']
		);
	});
	it('a formula reads twelve months back and no further', () => {
		const pay = (period: string, total: number) => ({ [period]: { total } });
		const view = viewOf(
			{
				pay: {
					BASE: { ...pay('XX.M.2025-03-01', 900), ...pay('XX.M.2025-02-01', 800) }
				}
			},
			'XX',
			1,
			'2026-03-25'
		);
		assert.deepEqual(view.month, { '2025-03.BASE': 900 });
	});
	it('a new year reads as empty, and the months stay', () => {
		const view = viewOf(
			{ pay: { BASE: { 'XX.Y.2025-01-01': { total: 900 }, 'XX.M.2025-12-01': { total: 900 } } } },
			'XX',
			1,
			'2026-01-25'
		);
		assert.deepEqual(view.ytd, {});
		assert.deepEqual(view.month, { '2025-12.BASE': 900 });
		assert.deepEqual(view.years, { '2025': { BASE: 900 } });
	});
	it('another scope reads as empty', () => {
		const view = viewOf(
			{ pay: { BASE: { 'YY.Y.2026-01-01': { total: 900 } } } },
			'XX',
			1,
			'2026-06-25'
		);
		assert.deepEqual(view.ytd, {});
	});
});
