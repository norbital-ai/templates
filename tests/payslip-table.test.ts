// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import relationships from '../src/collections/+relationship.ts';
import {
	payrollRunPayslipsQuery,
	payslipAmount,
	payslipEmployeeCode
} from '../src/collections/payroll_runs/payslip-table.ts';

const row = {
	id: 'payslip-1',
	employment_id: 'employment-1',
	currency: 'MYR',
	gross: '1724.00',
	total_deductions: '43.75',
	net: '1680.25',
	employer_cost: '65.65',
	payslip_employment: { employee_number: 'PUBEM0345' }
};

test('the payroll-run payslip query projects the employee code and every displayed total', () => {
	assert.deepEqual(payrollRunPayslipsQuery('run-1'), {
		where: { payroll_run_id: { eq: 'run-1' } },
		columns: {
			id: true,
			employment_id: true,
			currency: true,
			gross: true,
			total_deductions: true,
			net: true,
			employer_cost: true,
			created_at: true
		},
		orderBy: { created_at: 'asc' },
		with: {
			payslip_employment: { columns: { id: true, employee_number: true } }
		},
		limit: 500
	});
});

test('collection cells show the employee code and stored payroll totals', () => {
	assert.equal(payslipEmployeeCode(row), 'PUBEM0345');
	assert.equal(payslipAmount(row, 'gross'), '1,724.00');
	assert.equal(payslipAmount(row, 'total_deductions'), '43.75');
	assert.equal(payslipAmount(row, 'net'), '1,680.25');
	assert.equal(payslipAmount(row, 'employer_cost'), '65.65');
	assert.equal(payslipAmount({ ...row, total_deductions: '0' }, 'total_deductions'), '0.00');
	assert.equal(payslipEmployeeCode({ ...row, payslip_employment: null }), '—');
});

test('a payslip belongs to its run, while its employment remains protected settlement evidence', () => {
	const probe = new Proxy(
		{},
		{
			get: (_target, property) =>
				property === 'one' || property === 'many'
					? new Proxy({}, { get: () => () => ({}) })
					: new Proxy({}, { get: () => ({}) })
		}
	);
	const graph = relationships(probe);
	const markersOf = (edge) =>
		Object.getOwnPropertySymbols(edge).map((symbol) => Reflect.get(edge, symbol));

	assert.ok(markersOf(graph.payslips.payslip_payroll_run).includes('cascade'));
	assert.equal(
		markersOf(graph.payslips.payslip_employment).includes('cascade'),
		false,
		'deleting an employment must not silently delete a settled payslip'
	);
});
