import { checkExpression } from '../src/lib/payroll_engine/expressions.ts';
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import {
	calculatePayroll,
	subtotalChain,
	statutoryOrder,
	type PayrollInput
} from '../src/lib/payroll_engine/engine.ts';
import { read } from './kit.ts';

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
		entity_id: 'entity-1',
		pay_date: '2026-03-31',
		salary_coverage: { from: '2026-03-01', to: '2026-03-31' }
	},
	settings: { id: 'sg', code: 'SG', lookup: { working_days: 22 } },
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
		catalog('npl', 'NPL', { paid_share: '0' }),
		catalog('annual', 'ANNUAL_LEAVE', {
			subtotal_id: 'gross',
			payout: 'return ctx.entry.quantity * 227.27;'
		})
	],
	claim_catalog: [],
	adhoc_catalog: [],
	loan_catalog: [],
	employee: { id: 'employee-1' },
	employment: {
		id: 'contract-1',
		terms: {
			rate: { amount: 5000, unit: 'MONTHLY' },
			normal_hours_per_day: 8,
			normal_hours_per_week: 40,
			normal_days_per_week: 5
		}
	},
	employer: { id: 'entity-1' },
	balance: {
		id: 'balance-1',
		account: {
			statutory_contribution: { 'CPF.employee': 1000, 'CPF.employer': 850 }
		}
	},
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
				encashment: true,
				days: [
					{ date: '2026-03-09', part: 'AM' },
					{ date: '2026-03-09', part: 'PM' },
					{ date: '2026-03-10', part: 'AM' },
					{ date: '2026-03-10', part: 'PM' }
				]
			}
		]
	}
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
					subtotal_id: 'final',
					payout: 'return ctx.entry.quantity * 100;'
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
				terms: {
					rate: { amount: 5000, unit: 'MONTHLY' },
					normal_hours_per_day: 8,
					normal_hours_per_week: 40,
					normal_days_per_week: 5
				}
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
					conversion: 'return 300 * ctx.paid_share;'
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

	describe('a leave slot pays its paid_share of a normal day', () => {
		// 5,000 over March's 22 working days: 227.27 a day; two days
		const TWO_DAYS = [
			{ date: '2026-03-05', part: 'AM' },
			{ date: '2026-03-05', part: 'PM' },
			{ date: '2026-03-06', part: 'AM' },
			{ date: '2026-03-06', part: 'PM' }
		];
		const priced = (
			row: Record<string, unknown>,
			extra: Record<string, unknown> = {},
			over: Partial<PayrollInput> = {}
		) =>
			calculatePayroll({
				...input(),
				statutory: [],
				leave_catalog: [catalog('leave', 'LEAVE', { subtotal_id: 'base', ...row })],
				entries: {
					leave_catalog_entry: [
						{ id: 'leave-entry', catalog_id: 'leave', days: TWO_DAYS, ...extra }
					]
				},
				...over
			});
		const leaveLines = (result: ReturnType<typeof calculatePayroll>) =>
			result.lines.filter((row) => row.code === 'LEAVE').map((row) => [row.direction, row.amount]);
		const base = (result: ReturnType<typeof calculatePayroll>) =>
			result.subtotals.find((row) => row.code === 'BASE')?.value;

		it('empty or 1 is a normal paid day: no line, the salary stands', () => {
			for (const row of [{}, { paid_share: '1' }]) {
				const result = priced(row);
				assert.deepEqual(leaveLines(result), []);
				assert.equal(base(result), 5000);
			}
		});
		it('0 takes the days off the salary by the share of the period paid', () => {
			const result = priced({ paid_share: '0' });
			assert.deepEqual(leaveLines(result), []);
			assert.equal(base(result), 4545.45);
		});
		it('0.5 takes half of each day off, as a number or an expression', () => {
			for (const paid_share of ['0.5', 'return 0.5;']) {
				const result = priced({ paid_share });
				assert.deepEqual(leaveLines(result), []);
				// one day of 22 lost
				assert.equal(base(result), 4772.73);
			}
		});
		it('refuses a share outside 0 to 1', () => {
			for (const paid_share of ['1.5', 'return -0.5;'])
				assert.throws(() => priced({ paid_share }), /from 0 to 1 of a normal day/);
		});
		it('an encashment takes no day off and pays its payout', () => {
			const result = priced(
				{ paid_share: '0', payout: 'return ctx.entry.quantity * 100;' },
				{ encashment: true }
			);
			assert.deepEqual(leaveLines(result), [['ADD', 200]]);
			assert.equal(base(result), 5200);
		});
		it('a scheme can read the leave paid out in money and leave it out of its base', () => {
			const result = priced(
				{ paid_share: '0', payout: 'return ctx.entry.quantity * 100;' },
				{ encashment: true },
				{
					statutory: [
						catalog('levy', 'LEVY', {
							subtotal_id: 'cpf',
							employer_cost_subtotal_id: 'cpf',
							eligibility: 'return true;',
							employee_amount: 'return 0;',
							employer_amount: 'return (ctx.subtotals.BASE - ctx.encashment) * 0.01;'
						})
					]
				}
			);
			assert.equal(result.statutory.find((row) => row.code === 'LEVY')?.employer, 50);
		});
		it('steps down inside one entry where the illness passes its fourth month (Indonesia)', () => {
			const medical = read('seed/public/jurisdiction/ID/version_3/leave_catalog.json').find(
				(row) => row.code === 'MEDICAL_LEAVE'
			);
			const result = priced(
				{
					paid_share: medical?.paid_share,
					lookup: {
						opened_by: { LONG_ILLNESS: { days: 0 } },
						pay_steps: [
							{ until_month: 4, unpaid_share: 0 },
							{ until_month: null, unpaid_share: 0.25 }
						]
					}
				},
				{
					days: [
						{ date: '2026-03-19', part: 'AM' },
						{ date: '2026-03-19', part: 'PM' },
						{ date: '2026-03-20', part: 'AM' },
						{ date: '2026-03-20', part: 'PM' }
					]
				},
				{
					employment: {
						...input().employment,
						events: [{ kind: 'LONG_ILLNESS', on: '2025-11-20' }]
					}
				}
			);
			// 19 March is the illness's third month, paid in full; 20 March its fourth, which loses a quarter
			assert.equal(base(result), 4943.18);
		});
		it('reads the days its window used before each slot (a sick pool at half pay)', () => {
			const result = priced(
				{
					paid_share: 'return ctx.used < ctx.lookup.pool_days ? 0.5 : 0;',
					lookup: { pool_days: 1 }
				},
				{},
				{
					balance: {
						...input().balance,
						// half a day earlier in the year, and this entry's two
						leave: { LEAVE: { 'SG.Y.2026-01-01': { used: 2.5 } } }
					}
				}
			);
			// the first slot is inside the pool at half pay; the other three are past it and pay nothing
			assert.equal(base(result), 4602.27);
		});
	});

	it('prorates an allowance for a mid-month joiner by the share of the period paid', () => {
		const result = calculatePayroll({
			...input(),
			statutory: [],
			employed: [{ from: '2026-03-16', to: null }],
			allowance: [
				catalog('fixed', 'FIXED_ALLOWANCE', {
					subtotal_id: 'gross',
					conversion: 'return 300 * ctx.paid_share;'
				})
			],
			entries: {}
		});
		// 12 of March's 22 working days, as the salary: 300 × 12 ÷ 22
		assert.equal(result.lines.find((row) => row.code === 'FIXED_ALLOWANCE')?.amount, 163.64);
		assert.equal(result.subtotals.find((row) => row.code === 'BASE')?.value, 2727.27);
	});

	it('an ad hoc entry’s statutory posting reaches the run’s schemes by its account, and a quantity below zero flips it', () => {
		const posting = (quantity: number) =>
			calculatePayroll({
				...input(),
				statutory: [
					catalog('tax', 'TAX', {
						subtotal_id: 'cpf',
						employer_cost_subtotal_id: 'cpf',
						eligibility: 'return true;',
						employee_amount: "return 1000 - get(ctx.posted, 'FUND.employee', 0);",
						employer_amount: 'return 0;'
					})
				],
				adhoc_catalog: [
					catalog('fund-adjustment', 'FUND_ADJUSTMENT', {
						subtotal_id: 'net',
						direction: 'DEDUCT',
						party: 'EMPLOYEE',
						eligibility: 'return true;',
						conversion: 'return ctx.entry.quantity;',
						lookup: {
							accounts: [
								{ account: 'statutory', code: 'FUND.employee', measure: 'paid', operation: 'ADD' }
							]
						}
					})
				],
				entries: {
					adhoc_catalog_entry: [
						{ id: 'entry', catalog_id: 'fund-adjustment', quantity, unit: 'MONEY' }
					]
				}
			});
		const tax = (quantity: number) =>
			posting(quantity).statutory.find((row) => row.code === 'TAX')?.employee;
		const line = (quantity: number) =>
			posting(quantity)
				.lines.filter((row) => row.code === 'FUND_ADJUSTMENT')
				.map((row) => [row.direction, row.amount]);
		assert.equal(tax(100), 900);
		assert.deepEqual(line(100), [['DEDUCT', 100]]);
		assert.equal(tax(-100), 1100);
		assert.deepEqual(line(-100), [['ADD', 100]]);
	});

	it('pays a claim to the employee', () => {
		const claimed = calculatePayroll({
			...input(),
			statutory: [],
			claim_catalog: [
				catalog('medical', 'MEDICAL', {
					subtotal_id: 'net',
					conversion: 'return ctx.entry.quantity;'
				})
			],
			entries: {
				claim_catalog_entry: [{ id: 'claim', catalog_id: 'medical', quantity: 80, unit: 'MONEY' }]
			}
		}).lines.filter((row) => row.code === 'MEDICAL');
		assert.deepEqual(
			claimed.map((row) => [row.direction, row.party, row.amount]),
			[['ADD', 'EMPLOYEE', 80]]
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

	it('carries the balance through a transfer inside one jurisdiction', () => {
		const result = calculatePayroll({
			...input(),
			run: { ...input().run, entity_id: 'entity-2' }
		});
		assert.equal(result.statutory[0]?.employee_ytd, 2000);
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
				loan_catalog_entry_repayment: [
					repayment('due', amount, '2026-03-15'),
					repayment('later', 700, '2026-04-01')
				]
			}
		});
		const lines = calculatePayroll(value(300)).lines.filter(
			(line) => line.source_id?.model === 'loan_catalog_entry_repayment'
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
		assert.throws(
			() =>
				statutoryOrder([
					catalog('a', 'A', { depends_on: ['B'] }),
					catalog('b', 'B', { depends_on: ['A'] })
				]),
			/statutory dependency cycle/
		);
		assert.throws(
			() => statutoryOrder([catalog('a', 'A', { depends_on: ['MISSING'] })]),
			/MISSING: unknown statutory dependency/
		);
	});

	it('rejects branched or cyclic subtotal chains', () => {
		assert.throws(
			() =>
				subtotalChain([subtotal('a', 'A', null), subtotal('b', 'B', 'a'), subtotal('c', 'C', 'a')]),
			/one linear chain, not a branch/
		);
		assert.throws(
			() => subtotalChain([subtotal('a', 'A', 'b'), subtotal('b', 'B', 'a')]),
			/exactly one first checkpoint/
		);
		// a first checkpoint beside a closed loop: the walk from it never reaches the loop
		assert.throws(
			() =>
				subtotalChain([subtotal('a', 'A', null), subtotal('b', 'B', 'c'), subtotal('c', 'C', 'b')]),
			/Subtotal chain is disconnected/
		);
	});
});
