import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import {
	buildLoanSchedule,
	loanDisposition,
	loanRecovery,
	loanScheduleProblems,
	loanScheduleState,
	monthlyEquivalent
} from '../src/lib/payroll_engine/loan_schedule.ts';

const base = { principal: 1000, from: '2026-01-01', to: '2026-03-01', repayments: [] };

describe('loan repayment schedule', () => {
	it('moves NO_TERMS → READY → GENERATED → SEALED', () => {
		assert.equal(loanScheduleState({ ...base, principal: 0 }), 'NO_TERMS');
		assert.equal(loanScheduleState(base), 'READY');
		assert.equal(
			loanScheduleState({ ...base, repayments: [{ amount: 1000, paid_on: '2026-01-01' }] }),
			'GENERATED'
		);
		assert.equal(
			loanScheduleState({
				...base,
				repayments: [{ amount: 1000, paid_on: '2026-01-01', payroll_run_id: 'run-1' }]
			}),
			'SEALED'
		);
	});

	it('splits principal into monthly installments in minor units', () => {
		const plan = buildLoanSchedule(base);
		assert.deepEqual(
			plan.create.map((row) => [row.paid_on, row.amount]),
			[
				['2026-01-01', 333.33],
				['2026-02-01', 333.33],
				['2026-03-01', 333.34]
			]
		);
		assert.equal(plan.remove.length, 0);
	});

	it('keeps the sealed total and drops every open row when nothing remains', () => {
		const plan = buildLoanSchedule({
			...base,
			repayments: [
				{ id: 'sealed', amount: 1000, paid_on: '2026-01-01', payroll_run_id: 'run-1' },
				{ id: 'open', amount: 250, paid_on: '2026-02-01' }
			]
		});
		assert.deepEqual(plan, { create: [], remove: ['open'] });
	});

	it('reports an open total that does not match the principal', () => {
		assert.deepEqual(
			loanScheduleProblems({
				...base,
				repayments: [{ amount: 900, paid_on: '2026-01-01' }]
			}),
			['total']
		);
	});

	it('reports rows outside the period and months with no room left', () => {
		assert.ok(
			loanScheduleProblems({
				...base,
				repayments: [{ amount: 1000, paid_on: '2026-06-01' }]
			}).includes('outside')
		);
		assert.throws(
			() =>
				buildLoanSchedule({
					...base,
					repayments: [
						{ amount: 300, paid_on: '2026-01-01', payroll_run_id: 'run-1' },
						{ amount: 300, paid_on: '2026-02-01', payroll_run_id: 'run-1' },
						{ amount: 300, paid_on: '2026-03-01', payroll_run_id: 'run-1' }
					]
				}),
			/no unpaid months/
		);
	});

	it('refuses bad terms, duplicates and sealed totals above principal', () => {
		assert.ok(loanScheduleProblems({ ...base, principal: 0 }).includes('principal'));
		assert.ok(
			loanScheduleProblems({ ...base, from: '2026-04-01', to: '2026-03-01' }).includes('period')
		);
		assert.ok(
			loanScheduleProblems({
				...base,
				repayments: [
					{ amount: 500, paid_on: '2026-01-01' },
					{ amount: 500, paid_on: '2026-01-15' }
				]
			}).includes('duplicate')
		);
		assert.throws(
			() =>
				buildLoanSchedule({
					...base,
					repayments: [{ amount: 1200, paid_on: '2026-01-01', payroll_run_id: 'run-1' }]
				}),
			/Sealed repayments exceed/
		);
	});

	it('holds the generated schedule invariants across principals and periods', () => {
		const cases = [
			{ principal: 1000, from: '2026-01-01', to: '2026-01-01' },
			{ principal: 1000, from: '2026-01-01', to: '2026-03-01' },
			{ principal: 1000.01, from: '2026-01-01', to: '2026-03-01' },
			{ principal: 999.99, from: '2026-02-01', to: '2026-07-01' },
			{ principal: 100, from: '2026-01-15', to: '2026-12-15' }
		];
		for (const input of cases) {
			const plan = buildLoanSchedule({ ...input, repayments: [] });
			const total = plan.create.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
			assert.equal(total, Math.round(input.principal * 100), `${input.principal} total`);
			assert.equal(plan.remove.length, 0);
			const months = plan.create.map((row) => row.paid_on.slice(0, 7));
			assert.deepEqual(months, [...months].toSorted(), `${input.principal} order`);
			assert.equal(new Set(months).size, months.length, `${input.principal} one row per month`);
			assert.equal(months[0], input.from.slice(0, 7));
			assert.equal(months.at(-1), input.to.slice(0, 7));
			assert.ok(
				plan.create.every((row) => row.amount > 0 && Number.isInteger(Math.round(row.amount * 100)))
			);
		}
	});

	it('keeps every sealed row and replaces only open rows', () => {
		const plan = buildLoanSchedule({
			...base,
			principal: 1200,
			repayments: [
				{ id: 'sealed-a', amount: 200, paid_on: '2026-01-01', payroll_run_id: 'run-1' },
				{ id: 'sealed-b', amount: 200, paid_on: '2026-02-01', payroll_run_id: 'run-2' },
				{ id: 'open', amount: 50, paid_on: '2026-03-01' }
			]
		});
		assert.deepEqual(plan.remove, ['open']);
		assert.equal(plan.create.length, 1);
		assert.deepEqual(plan.create[0], { amount: 800, paid_on: '2026-03-01', payroll_run_id: null });
		assert.equal(
			loanScheduleState({
				...base,
				repayments: [
					{ amount: 200, paid_on: '2026-01-01', payroll_run_id: 'run-1' },
					{ amount: 100, paid_on: '2026-02-01' }
				]
			}),
			'SEALED'
		);
	});
	it('carries same-jurisdiction loans and transfers only when the target has the code', () => {
		assert.equal(loanDisposition({ carry: true, settle: false, targetCatalog: false }), 'CARRY');
		assert.equal(loanDisposition({ carry: false, settle: false, targetCatalog: true }), 'TRANSFER');
		assert.equal(loanDisposition({ carry: false, settle: false, targetCatalog: false }), 'SETTLE');
		assert.equal(loanDisposition({ carry: false, settle: true, targetCatalog: true }), 'SETTLE');
	});
});

describe('final-pay loan recovery', () => {
	const two = [
		{ id: 'b', outstanding: 300 },
		{ id: 'a', outstanding: 700.55 }
	];
	const recover = (expectedPay: number, floorPercent = 10, decimals = 2) =>
		loanRecovery({ loans: two, expectedPay, floorPercent, decimals });

	it('settles in full when pay covers the balance', () => {
		const plan = recover(10000);
		assert.equal(plan.proposed, 1000.55);
		assert.equal(plan.remaining, 0);
		assert.deepEqual(plan.allocations, [
			{ id: 'a', final: 700.55, remaining: 0 },
			{ id: 'b', final: 300, remaining: 0 }
		]);
	});

	it('caps at expected pay less the floor and allocates in id order, to the exact cap', () => {
		const plan = recover(800);
		assert.equal(plan.maximum, 720);
		assert.equal(plan.proposed, 720);
		assert.equal(plan.remaining, 280.55);
		assert.deepEqual(plan.allocations, [
			{ id: 'a', final: 700.55, remaining: 0 },
			{ id: 'b', final: 19.45, remaining: 280.55 }
		]);
	});

	it('honours the 0% and 100% floors and zero pay', () => {
		assert.equal(recover(800, 0).proposed, 800);
		assert.equal(recover(800, 100).proposed, 0);
		const none = recover(0);
		assert.equal(none.proposed, 0);
		assert.equal(none.remaining, 1000.55);
		assert.equal(recover(-50).proposed, 0);
	});

	it('rounds down to the currency, so a zero-decimal cap never overflows', () => {
		assert.equal(
			loanRecovery({
				loans: [{ id: 'a', outstanding: 900 }],
				expectedPay: 333,
				floorPercent: 10,
				decimals: 0
			}).proposed,
			299
		);
	});

	it('normalises a contract rate to a month, leaving an unknown unit to a person', () => {
		assert.equal(monthlyEquivalent({ rate: { amount: 3000, unit: 'MONTHLY' } }), 3000);
		assert.equal(
			monthlyEquivalent({ rate: { amount: 120, unit: 'DAILY' }, normal_days_per_week: 5 }),
			2600
		);
		assert.equal(
			monthlyEquivalent({ rate: { amount: 10, unit: 'HOURLY' }, normal_hours_per_week: 48 }),
			2080
		);
		assert.equal(monthlyEquivalent({ rate: { amount: 10, unit: 'HOURLY' } }), null);
	});
});
