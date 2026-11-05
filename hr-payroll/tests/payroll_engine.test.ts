import { checkExpression } from '../src/lib/payroll_engine/expressions.ts';
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
	calculatePayroll,
	subtotalChain,
	statutoryOrder,
	type PayrollInput
} from '../src/lib/payroll_engine/engine.ts';
import { applyOperations } from '../src/lib/payroll_engine/balance.ts';
import { assertApprovalBalance } from '../src/lib/payroll_engine/approval_posting.ts';
import type { Reader } from '../src/lib/payroll_engine/reads.ts';

const subtotal = (id: string, code: string, previous_id: string | null) => ({
	id,
	code,
	name: code,
	previous_id,
	settings_id: 'sg'
});
const catalog = (id: string, code: string, extra: Record<string, unknown> = {}) => ({
	id,
	code,
	name: code,
	settings_id: 'sg',
	...extra
});
const input = (): PayrollInput => ({
	run: {
		id: 'run-1',
		pay_date: '2026-03-31',
		salary_coverage: { from: '2026-03-01', to: '2026-03-31' }
	},
	settings: { id: 'sg', lookup: { working_days: 22 } },
	subtotals: [
		subtotal('base', 'BASE', null),
		subtotal('gross', 'GROSS', 'base'),
		subtotal('cpf', 'CPF', 'gross'),
		subtotal('net', 'NET', 'cpf')
	],
	allowance: [],
	overtime: [],
	statutory: [
		catalog('cpf-scheme', 'CPF', {
			subtotal_id: 'cpf',
			employer_cost_subtotal_id: 'cpf',
			eligibility: 'return true;',
			employee_amount: 'return ctx.subtotals.GROSS * 0.2;',
			employer_amount: 'return ctx.subtotals.GROSS * 0.17;'
		})
	],
	leave_catalog: [
		catalog('npl', 'NPL', { pay_treatment: 'UNPAID' }),
		catalog('annual', 'ANNUAL_LEAVE', {
			pay_treatment: 'PAID',
			subtotal_id: 'gross',
			conversion: 'return ctx.entry.quantity * 227.27;'
		})
	],
	claim_catalog: [],
	adhoc_catalog: [],
	loan_catalog: [],
	employee: { id: 'employee-1' },
	employment: {
		id: 'contract-1',
		terms: { rate: { amount: 5000, unit: 'MONTHLY' } }
	},
	employer: { id: 'entity-1' },
	balance: { id: 'balance-1', account: { leave: { ANNUAL_LEAVE: 10 } } },
	entries: {
		leave_catalog_entry: [
			{
				id: 'npl-entry',
				catalog_id: 'npl',
				days: [
					{ date: '2026-03-05', part: 'AM' },
					{ date: '2026-03-05', part: 'PM' },
					{ date: '2026-03-06', part: 'AM' },
					{ date: '2026-03-06', part: 'PM' }
				]
			},
			{
				id: 'encash-entry',
				catalog_id: 'annual',
				days: [
					{ date: '2026-03-09', part: 'AM' },
					{ date: '2026-03-09', part: 'PM' },
					{ date: '2026-03-10', part: 'AM' },
					{ date: '2026-03-10', part: 'PM' }
				]
			}
		]
	},
	history: { statutory: [{ code: 'CPF', employee: 1000, employer: 850 }] }
});

describe('linear payroll engine', () => {
	it('computes Singapore base, encashment, CPF and YTD in chain order', () => {
		const result = calculatePayroll(input());
		assert.deepEqual(
			result.subtotals.map((row) => [row.code, row.value]),
			[
				['BASE', 4545.45],
				['GROSS', 4999.99],
				['CPF', 3999.99],
				['NET', 3999.99]
			]
		);
		assert.equal(result.employer_cost, 850);
		assert.deepEqual(result.statutory[0], {
			code: 'CPF',
			kind: 'CONTRIBUTION',
			employee: 1000,
			employer: 850,
			employee_ytd: 2000,
			employer_ytd: 1700
		});
		assert.deepEqual(
			result.ledger.map((row) => [row.account, row.code, row.operation, row.amount]),
			[
				['payroll', 'NET_PAY', 'ADD', 3999.99],
				['statutory_contribution', 'CPF.employee', 'ADD', 1000],
				['statutory_contribution', 'CPF.employer', 'ADD', 850]
			]
		);
	});

	it('pays only a flagged annual-leave encashment in FINAL_PAY', () => {
		const base = input();
		const value: PayrollInput = {
			...base,
			subtotals: [
				subtotal('base', 'BASE', null),
				subtotal('gross', 'GROSS', 'base'),
				subtotal('final', 'FINAL_PAY', 'gross')
			],
			statutory: [],
			leave_catalog: [
				catalog('encash', 'ANNUAL_LEAVE', {
					pay_treatment: 'PAID',
					subtotal_id: 'final',
					conversion:
						"return get(ctx.entry, 'encashment', false) === true ? ctx.entry.quantity * 100 : 0;"
				})
			],
			entries: {
				leave_catalog_entry: [
					{
						id: 'encash-entry',
						catalog_id: 'encash',
						encashment: true,
						days: Array.from({ length: 24 }, (_, index) => ({
							date: '2026-03-09',
							part: index % 2 === 0 ? 'AM' : 'PM'
						}))
					},
					{
						id: 'posted-entry',
						catalog_id: 'encash',
						encashment: true,
						payroll_run_id: 'run-earlier',
						days: Array.from({ length: 24 }, (_, index) => ({
							date: '2026-03-09',
							part: index % 2 === 0 ? 'AM' : 'PM'
						}))
					}
				]
			}
		};
		const result = calculatePayroll(value);
		const lines = result.lines.filter(
			(row) => row.subtotal_id === 'final' && row.code === 'ANNUAL_LEAVE'
		);
		assert.equal(lines.length, 1);
		assert.equal(lines[0]?.amount, 1200);
		assert.equal(result.subtotals.find((row) => row.code === 'FINAL_PAY')?.value, 6200);
	});

	it('reads service_started_on as the service start for entitlement expressions', () => {
		const value: PayrollInput = {
			...input(),
			employment: {
				id: 'contract-1',
				effective_range: { from: '2026-11-05', to: null },
				service_started_on: '2020-01-01',
				terms: { rate: { amount: 5000, unit: 'MONTHLY' } }
			},
			allowance: [
				catalog('service', 'SERVICE', {
					subtotal_id: 'gross',
					eligibility: 'return true;',
					conversion:
						"return ctx.subject.employment.effective_range.from === '2020-01-01' ? 100 : 0;"
				})
			]
		};
		const result = calculatePayroll(value);
		const line = result.lines.find((row) => row.code === 'SERVICE');
		assert.ok(line !== undefined);
		assert.equal(line.amount, 100);
	});

	it('prorates a recurring allowance by unpaid leave', () => {
		const base = input();
		const value: PayrollInput = {
			...base,
			allowance: [
				catalog('fixed', 'FIXED_ALLOWANCE', {
					subtotal_id: 'gross',
					direction: 'ADD',
					party: 'EMPLOYEE',
					conversion: 'return 300;',
					lookup: { prorate: true }
				})
			],
			entries: {
				leave_catalog_entry: [
					{
						id: 'npl-entry',
						catalog_id: 'npl',
						days: [
							{ date: '2026-03-05', part: 'AM' },
							{ date: '2026-03-05', part: 'PM' },
							{ date: '2026-03-06', part: 'AM' },
							{ date: '2026-03-06', part: 'PM' }
						]
					}
				]
			}
		};
		const result = calculatePayroll(value);
		assert.deepEqual(
			result.subtotals.map((row) => [row.code, row.value]),
			[
				['BASE', 4545.45],
				['GROSS', 4818.18],
				['CPF', 3854.54],
				['NET', 3854.54]
			]
		);
	});

	it('cuts salary for an ABS day as it does for an unpaid leave day', () => {
		const npl = {
			...input(),
			entries: {
				...input().entries,
				leave_catalog_entry: [
					{
						id: 'leave-1',
						catalog_id: 'npl',
						days: [
							{ date: '2026-03-05', part: 'AM' },
							{ date: '2026-03-05', part: 'PM' }
						]
					}
				]
			}
		};
		const abs = {
			...input(),
			entries: { ...input().entries, leave_catalog_entry: [] },
			work: { days: [{ date: '2026-03-05', day_type: 'ABS' }] }
		};
		assert.deepEqual(
			calculatePayroll(abs).subtotals.map((row) => row.value),
			calculatePayroll(npl).subtotals.map((row) => row.value)
		);
	});

	it('accepts a subtotal the version declares and refuses an unknown one', () => {
		const source = 'return ctx.subtotals.GROSS;';
		checkExpression(source, 'CALCULATION');
		checkExpression(source, 'CALCULATION', new Set(['GROSS']));
		assert.throws(
			() => checkExpression(source, 'CALCULATION', new Set(['NET'])),
			/unknown subtotal/
		);
	});

	it('deducts a loan instalment only in the run that covers its date', () => {
		const base = input();
		const repayment = (id: string, amount: number, paid_on: string) => ({
			id,
			employment_id: 'contract-1',
			loan_id: 'loan-1',
			amount,
			paid_on
		});
		const value = (amount: number): PayrollInput => ({
			...base,
			statutory: [],
			subtotals: [subtotal('base', 'BASE', null), subtotal('net', 'NET', 'base')],
			loan_catalog: [catalog('staff-loan', 'STAFF_LOAN', { subtotal_id: 'net' })],
			entries: {
				loan_catalog_entry: [{ id: 'loan-1', catalog_id: 'staff-loan' }],
				loan_repayment_entry: [
					repayment('due', amount, '2026-03-15'),
					repayment('later', 700, '2026-04-01')
				]
			}
		});
		const lines = calculatePayroll(value(300)).lines.filter(
			(line) => line.source_id?.model === 'loan_repayment_entry'
		);
		assert.deepEqual(
			lines.map((line) => line.amount),
			[300]
		);
		assert.throws(() => calculatePayroll(value(999999)), /loan recovery would leave net pay/);
	});

	it('keeps final pay out of ordinary wages while it reaches net and tax', () => {
		const base = input();
		const value: PayrollInput = {
			...base,
			subtotals: [
				subtotal('base', 'BASIC', null),
				subtotal('ow', 'ORDINARY_WAGES', 'base'),
				subtotal('aw', 'ADDITIONAL_WAGES', 'ow'),
				subtotal('gross', 'GROSS', 'aw'),
				subtotal('final', 'FINAL_PAY', 'gross'),
				subtotal('net', 'NET', 'final')
			],
			leave_catalog: [],
			claim_catalog: [],
			adhoc_catalog: [
				catalog('terminal', 'TERMINATION_BENEFIT', {
					subtotal_id: 'final',
					direction: 'ADD',
					party: 'EMPLOYEE',
					conversion: 'return 20000;'
				})
			],
			entries: {
				adhoc_catalog_entry: [
					{ id: 'terminal-entry', catalog_id: 'terminal', incurred_on: '2026-03-31' }
				]
			},
			statutory: [
				catalog('si', 'SI', {
					subtotal_id: 'net',
					employer_cost_subtotal_id: 'net',
					eligibility: 'return true;',
					employee_amount: 'return 500;',
					employer_amount: 'return 0;'
				}),
				catalog('tax', 'TAX', {
					kind: 'TAX',
					subtotal_id: 'net',
					eligibility: 'return true;',
					employee_amount: 'return ctx.base_pay * 0.1;',
					employer_amount: 'return 0;'
				})
			]
		};

		const result = calculatePayroll(value);
		assert.deepEqual(
			result.subtotals.map((row) => [row.code, row.value]),
			[
				['BASIC', 5000],
				['ORDINARY_WAGES', 5000],
				['ADDITIONAL_WAGES', 5000],
				['GROSS', 5000],
				['FINAL_PAY', 25000],
				['NET', 22000]
			]
		);
		assert.deepEqual(
			result.statutory.map((row) => [row.code, row.employee]),
			[
				['SI', 500],
				['TAX', 2500]
			]
		);
	});

	it('reverses NPL instead of prorating the absence again', () => {
		const value = input();
		const entries = {
			...value.entries,
			leave_catalog_entry: [
				{
					id: 'npl-reversal',
					catalog_id: 'npl',
					is_reversal: true,
					days: [
						{ date: '2026-03-05', part: 'AM' },
						{ date: '2026-03-05', part: 'PM' },
						{ date: '2026-03-06', part: 'AM' },
						{ date: '2026-03-06', part: 'PM' }
					]
				}
			]
		};
		const result = calculatePayroll({ ...value, entries });
		assert.equal(result.subtotals[0]?.value, 5000);
		assert.equal(result.net_pay, 4000);
	});

	it('evaluates arbitrary configured JavaScript at each checkpoint', () => {
		const value = input();
		const subtotals = value.subtotals.map((row) =>
			row.id === 'base'
				? {
						...row,
						calculation: 'return ctx.subject.employment.terms.rate.amount / 22 * 20;'
					}
				: row
		);
		assert.equal(calculatePayroll({ ...value, subtotals }).subtotals[0]?.value, 4545.45);
	});

	it('orders statutory dependencies and rejects cycles', () => {
		const a = catalog('a', 'A', { depends_on: ['B'] });
		const b = catalog('b', 'B');
		assert.deepEqual(
			statutoryOrder([a, b]).map((row) => row.code),
			['B', 'A']
		);
		assert.throws(() =>
			statutoryOrder([
				catalog('a', 'A', { depends_on: ['B'] }),
				catalog('b', 'B', { depends_on: ['A'] })
			])
		);
		assert.throws(() => statutoryOrder([catalog('a', 'A', { depends_on: ['MISSING'] })]));
	});

	it('rejects branched or cyclic subtotal chains', () => {
		assert.throws(() =>
			subtotalChain([subtotal('a', 'A', null), subtotal('b', 'B', 'a'), subtotal('c', 'C', 'a')])
		);
		assert.throws(() => subtotalChain([subtotal('a', 'A', 'b'), subtotal('b', 'B', 'a')]));
	});
});

describe('balance projection', () => {
	it('applies approval operations immediately and inverse operations on reversal', () => {
		const start = { leave: { ANNUAL_LEAVE: 10 } };
		const deducted = applyOperations(start, [
			{
				operation: 'DEDUCT',
				account: 'leave',
				code: 'ANNUAL_LEAVE',
				amount: 2,
				effective_on: '2026-03-01'
			}
		]);
		assert.deepEqual(deducted, { leave: { ANNUAL_LEAVE: 8 } });
		const restored = applyOperations(deducted, [
			{
				operation: 'ADD',
				account: 'leave',
				code: 'ANNUAL_LEAVE',
				amount: 2,
				effective_on: '2026-03-02'
			}
		]);
		assert.deepEqual(restored, start);
	});

	it('refuses a leave approval that would overdraw the account', async () => {
		const read: Reader = () =>
			Effect.succeed({
				employee_contract: {
					rows: [{ id: 'c1', employee_id: 'e1', entity_id: 'x1' }],
					next: null,
					total: 1
				},
				leave_catalog: {
					rows: [{ id: 'cat1', code: 'ANNUAL_LEAVE' }],
					next: null,
					total: 1
				},
				employee_balance: {
					rows: [{ id: 'b1', employee_id: 'e1', account: { leave: { ANNUAL_LEAVE: 1 } } }],
					next: null,
					total: 1
				}
			});
		const entry = {
			id: 'l1',
			employment_id: 'c1',
			catalog_id: 'cat1',
			days: [
				{ date: '2026-12-20', part: 'AM' },
				{ date: '2026-12-20', part: 'PM' },
				{ date: '2026-12-21', part: 'AM' },
				{ date: '2026-12-21', part: 'PM' }
			]
		};
		await assert.rejects(() =>
			Effect.runPromise(assertApprovalBalance(read, 'leave', [entry], '2026-12-20'))
		);
	});

	it('creates accounts and refuses invalid remove/insufficient deduction', () => {
		const created = applyOperations({}, [
			{
				operation: 'CREATE',
				account: 'loan',
				code: 'LOAN-1',
				amount: 1000,
				effective_on: '2026-03-01'
			}
		]);
		assert.deepEqual(created, { loan: { 'LOAN-1': 1000 } });
		assert.throws(() =>
			applyOperations(created, [
				{
					operation: 'REMOVE',
					account: 'loan',
					code: 'LOAN-1',
					amount: 0,
					effective_on: '2026-03-01'
				}
			])
		);
		assert.throws(() =>
			applyOperations(created, [
				{
					operation: 'DEDUCT',
					account: 'loan',
					code: 'LOAN-1',
					amount: 1001,
					effective_on: '2026-03-01'
				}
			])
		);
	});
});
