// What a statutory row returns decides what happens. Below zero, a row whose statute has the employer repay pays an `ADD`
// line on that run and its balance falls by the refund; any other stops at zero and the next run nets it.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { diff } from '../../src/lib/ledger/core.ts';
import { payslipWanted } from '../../src/lib/ledger/service.ts';
import { calculatePayroll, type PayrollInput } from '../../src/lib/payroll_engine/engine.ts';
import { jsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { breakdownOf } from '../../src/lib/payroll_engine/payslip_breakdown.ts';

const subtotal = (code: string, previous: string | null) => ({ code, name: code, previous });
const owing = (amount: number, lookup: object = {}): PayrollInput => ({
	run: {
		id: 'run',
		entity_id: 'entity',
		pay_date: '2026-12-25',
		salary_coverage: { from: '2026-12-01', to: '2026-12-31' }
	},
	settings: { code: 'XX', lookup: { working_days: 22 } },
	subtotals: [subtotal('BASE', null), subtotal('TAX', 'BASE'), subtotal('NET', 'TAX')],
	allowance: [],
	overtime: [],
	statutory: [
		{
			code: 'WITHHOLDING',
			name: 'WITHHOLDING',
			kind: 'TAX',
			subtotal: 'TAX',
			eligibility: 'return true;',
			employee_amount: `return ${amount};`,
			lookup: { ...lookup }
		}
	],
	leave_catalog: [],
	claim_catalog: [],
	adhoc_catalog: [],
	loan_catalog: [],
	employee: { id: 'employee' },
	employment: {
		id: 'contract',
		terms: {
			rate: { amount: 5000, unit: 'MONTHLY' },
			normal_hours_per_day: 8,
			normal_hours_per_week: 40,
			normal_days_per_week: 5
		}
	},
	employer: { id: 'entity' },
	balance: {
		id: 'balance',
		account: { statutory_contribution: { 'WITHHOLDING.employee': 1000 } }
	},
	entries: {}
});
const movements = (input: PayrollInput) => {
	const wanted = payslipWanted(jsonObject(breakdownOf(calculatePayroll(input))), '2026-12-25', {
		scope: 'XX',
		started: '2025-01-01',
		events: [],
		taxYearStart: 1,
		byMonth: []
	});
	return diff(
		'payroll_run:run',
		wanted.filter((row) => row.account === 'statutory'),
		[]
	).map(({ code, operation, measure, amount }) => [code, operation, measure, amount]);
};
const taxLine = (input: PayrollInput) =>
	calculatePayroll(input).lines.find((line) => line.code === 'WITHHOLDING');

describe('a statutory row', () => {
	it('above zero is a deduction, and its balance rises', () => {
		const input = owing(300);
		assert.equal(taxLine(input)?.direction, 'DEDUCT');
		assert.equal(calculatePayroll(input).net_pay, 4700);
		assert.deepEqual(movements(input), [['WITHHOLDING.employee', 'ADD', 'paid', 300]]);
	});
	it('at zero has no line, and its balance stands', () => {
		const input = owing(0, { below_zero: 'REFUND' });
		assert.equal(taxLine(input), undefined);
		assert.deepEqual(movements(input), []);
	});
	it('below zero with REFUND pays an ADD line, and its balance falls by the refund', () => {
		const input = owing(-300, { below_zero: 'REFUND' });
		const result = calculatePayroll(input);
		assert.equal(result.statutory[0]?.employee, -300);
		assert.equal(result.statutory[0]?.employee_ytd, 700);
		const line = taxLine(input);
		assert.equal(line?.direction, 'ADD');
		assert.equal(line?.amount, 300);
		assert.equal(result.net_pay, 5300);
		assert.deepEqual(movements(input), [['WITHHOLDING.employee', 'DEDUCT', 'paid', 300]]);
	});
	it('below zero with no route stops at zero and carries: nothing is lost or repaid', () => {
		const input = owing(-300);
		const result = calculatePayroll(input);
		assert.equal(result.statutory[0]?.employee, 0);
		assert.equal(result.statutory[0]?.employee_ytd, 1000);
		assert.equal(taxLine(input), undefined);
		assert.equal(result.net_pay, 5000);
		assert.deepEqual(movements(input), []);
	});
	it('never shows a negative line or a negative ledger amount', () => {
		for (const input of [owing(-300, { below_zero: 'REFUND' }), owing(-300)]) {
			assert.ok(calculatePayroll(input).lines.every((line) => line.amount >= 0));
			assert.ok(movements(input).every(([, , , amount]) => Number(amount) >= 0));
		}
	});
});
