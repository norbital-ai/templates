// Figures a formula needs by month live in the balance, keyed by pay month, and leave by dated entries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { applyOperations } from '../src/lib/payroll_engine/balance.ts';
import { calculatePayroll, type PayrollInput } from '../src/lib/payroll_engine/engine.ts';
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

const input = (account: PayrollInput['balance']['account']): PayrollInput => ({
	run: {
		id: 'run',
		pay_date: '2026-03-25',
		salary_coverage: { from: '2026-03-01', to: '2026-03-31' }
	},
	settings: { id: 'x', code: 'JP', lookup: { month_balance: ['BASE'] } },
	subtotals: [{ id: 'base', code: 'BASE', name: 'BASE', previous_id: null, settings_id: 'x' }],
	allowance: [],
	overtime: [],
	statutory: [],
	leave_catalog: [],
	claim_catalog: [],
	adhoc_catalog: [],
	loan_catalog: [],
	employee: { id: 'person' },
	employment: { id: 'contract', terms: { rate: { amount: 1000, unit: 'MONTHLY' } } },
	employer: { id: 'entity' },
	balance: { id: 'balance', account },
	entries: {}
});

describe('month balance', () => {
	it('posts what the jurisdiction names under the pay month', () => {
		const { ledger } = calculatePayroll(input({ ytd: { TAX_YEAR: 2026, 'LAW.JP': 1 }, month: {} }));
		assert.deepEqual(
			ledger.filter((row) => row.account === 'month').map((row) => [row.code, row.amount]),
			[['2026-03.BASE', 1000]]
		);
	});

	it('keeps twelve months back and clears anything older with dated entries', () => {
		const { ledger } = calculatePayroll(
			input({
				ytd: { TAX_YEAR: 2026, 'LAW.JP': 1 },
				month: { '2025-03.BASE': 900, '2025-02.BASE': 800 }
			})
		);
		assert.deepEqual(
			ledger
				.filter((row) => row.account === 'month' && row.operation !== 'ADD')
				.map((row) => [row.operation, row.code]),
			[
				['DEDUCT', '2025-02.BASE'],
				['REMOVE', '2025-02.BASE']
			]
		);
	});

	it('the January reset leaves the months in place', () => {
		const { ledger } = calculatePayroll({
			...input({ ytd: { TAX_YEAR: 2025, 'LAW.JP': 1 }, month: { '2025-12.BASE': 900 } }),
			run: {
				id: 'run',
				pay_date: '2026-01-25',
				salary_coverage: { from: '2026-01-01', to: '2026-01-31' }
			}
		});
		assert.equal(
			ledger.some((row) => row.account === 'month' && row.operation === 'DEDUCT'),
			false
		);
	});
});

describe('closing a code', () => {
	it('float dust neither blocks a removal nor reads as a shortfall', () => {
		const held = 1234.56 + 789.01;
		const stored = Number(held.toFixed(12));
		const close = (amount: number) =>
			applyOperations({ month: { key: held } }, [
				{ operation: 'DEDUCT', account: 'month', code: 'key', amount, effective_on: '2027-02-25' },
				{
					operation: 'REMOVE',
					account: 'month',
					code: 'key',
					amount: 0,
					effective_on: '2027-02-25'
				}
			]);
		assert.deepEqual(close(stored), { month: {} });
		assert.deepEqual(close(stored + 1e-12), { month: {} });
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
