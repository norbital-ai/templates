// Figures a formula needs by month live in the balance, keyed by pay month, and leave by dated entries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { viewOf } from '../src/lib/ledger/core.ts';
import { payslipWanted } from '../src/lib/ledger/service.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';

type Row = { readonly code: string; readonly employee_amount: string; readonly lookup?: object };
const version = (code: string, n: number) => `seed/public/jurisdiction/${code}/version_${n}`;
const rowOf = (code: string, n: number, scheme: string) => {
	const rows: readonly Row[] = JSON.parse(
		readFileSync(`${version(code, n)}/statutory_contribution_catalog.json`, 'utf8')
	);
	const row = rows.find((candidate) => candidate.code === scheme);
	assert.ok(row !== undefined);
	const [settings]: readonly { readonly lookup: object }[] = JSON.parse(
		readFileSync(`${version(code, n)}/jurisdiction_settings.json`, 'utf8')
	);
	return { source: row.employee_amount, lookup: { ...settings?.lookup, ...row.lookup } };
};

describe('month balance', () => {
	const slip = { checkpoints: [{ code: 'BASE', value: 1000 }], statutory: [] };
	const subject = { scope: 'JP', started: '2025-01-01', events: [], taxYearStart: 1 };
	it('holds what the jurisdiction names under the pay month, beside the year', () => {
		const wanted = payslipWanted(slip, '2026-03-25', { ...subject, byMonth: ['BASE'] });
		assert.deepEqual(
			wanted.map((row) => [row.account, row.code, row.period, row.amount]),
			[
				['pay', 'BASE', 'JP.Y.2026-01-01', 1000],
				['pay', 'BASE', 'JP.M.2026-03-01', 1000]
			]
		);
	});
	it('holds only the year for what it does not name', () => {
		const wanted = payslipWanted(slip, '2026-03-25', { ...subject, byMonth: [] });
		assert.deepEqual(
			wanted.map((row) => row.period),
			['JP.Y.2026-01-01']
		);
	});
	it('a formula reads twelve months back and no further', () => {
		const pay = (period: string, total: number) => ({ [period]: { total } });
		const view = viewOf(
			{
				pay: {
					BASE: { ...pay('JP.M.2025-03-01', 900), ...pay('JP.M.2025-02-01', 800) }
				}
			},
			'JP',
			1,
			'2026-03-25'
		);
		assert.deepEqual(view.month, { '2025-03.BASE': 900 });
	});
	it('a new year reads as empty, and the months stay', () => {
		const view = viewOf(
			{ pay: { BASE: { 'JP.Y.2025-01-01': { total: 900 }, 'JP.M.2025-12-01': { total: 900 } } } },
			'JP',
			1,
			'2026-01-25'
		);
		assert.deepEqual(view.ytd, {});
		assert.deepEqual(view.month, { '2025-12.BASE': 900 });
		assert.deepEqual(view.years, { '2025': { BASE: 900 } });
	});
	it('another country reads as empty', () => {
		const view = viewOf(
			{ pay: { BASE: { 'MY.Y.2026-01-01': { total: 900 } } } },
			'SG',
			1,
			'2026-06-25'
		);
		assert.deepEqual(view.ytd, {});
	});
});

describe('figures a month holds', () => {
	it('Japan caps pension on every bonus paid in the month together', () => {
		const { source, lookup } = rowOf('JP', 17, 'PENSION_BONUS');
		const amount = (paid: number) =>
			evaluate(
				source,
				'CALCULATION',
				{
					lookup,
					run: { pay_date: '2026-06-30' },
					subtotals: { ORDINARY_WAGES: 0, ADDITIONAL_WAGES: 1_000_000 },
					balances: { month: { '2026-06.ORDINARY_WAGES': 0, '2026-06.ADDITIONAL_WAGES': paid } }
				},
				'PENSION_BONUS'
			);
		// the second bonus of the month has ¥500,000 of the ¥1.5m ceiling left, a half of the first's premium
		assert.equal(Number(amount(0)), 2 * Number(amount(1_000_000)));
		assert.equal(Number(amount(1_500_000)), 0);
	});

	it('Philippines settles the month on its actual wages in the second cycle', () => {
		const { source, lookup } = rowOf('PH', 2, 'HDMF');
		const context = (month: object, wages: number) => ({
			lookup,
			run: {
				pay_date: '2026-05-31',
				salary_coverage: { from: '2026-05-16', to: '2026-05-31' }
			},
			subject: {
				employment: { effective_range: { from: '2020-01-01', to: null }, terms: {} },
				employer: { payment_schedule: { frequency: 'SEMI_MONTHLY' } }
			},
			base_pay: wages,
			subtotals: { ORDINARY_WAGES: wages },
			balances: { month }
		});
		const firstCycle = Number(evaluate(source, 'CALCULATION', context({}, 10_000), 'first cycle'));
		const second = Number(
			evaluate(
				source,
				'CALCULATION',
				context({ '2026-05.ORDINARY_WAGES': 10_000, '2026-05.HDMF.employee': firstCycle }, 30_000),
				'second cycle'
			)
		);
		const month = Number(
			evaluate(
				source,
				'CALCULATION',
				context({ '2026-05.ORDINARY_WAGES': 1 }, 39_999),
				'the month on its wages'
			)
		);
		assert.equal(firstCycle + second, month);
	});
});
