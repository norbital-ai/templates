/** L-TPL-hr-payroll-137 bank file (OCBC FAST / CSV) and per-employee payslip CSV. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	bankDocument,
	payable,
	payrollExportDocuments,
	payslipDocument
} from '../src/lib/payroll_engine/export.ts';

const kavriel = {
	employee_number: 'E-01',
	name: 'Kavriel Tan',
	bank: {
		bank_code: 'OCBCSGSGXXX',
		bank_account_number: '123456789',
		bank_account_name: 'KAVRIEL TAN'
	},
	amount: '6500.00',
	currency: 'SGD',
	status: 'DRAFT',
	period: '2026-03',
	gross: '6500.00',
	total_deductions: '0',
	lines: [{ component_code: 'BASIC', amount: '6500.00' }]
};

describe('payroll export', () => {
	it('L-TPL-hr-payroll-137 writes OCBC FAST when the payer is OCBCSG and CSV otherwise', () => {
		const fast = bankDocument(
			{
				bank_code: 'OCBCSGSGXXX',
				bank_account_number: '999',
				bank_account_name: 'ACME PTE LTD'
			},
			'2026-03',
			[kavriel]
		);
		assert.ok(fast);
		assert.equal(fast.name, 'bank-2026-03.fast.txt');
		assert.match(fast.content, /^0/);
		assert.match(fast.content, /^1/m);
		assert.match(fast.content, /KAVRIEL TAN/);
		const csv = bankDocument({ bank_code: 'DBSSSGSG' }, '2026-03', [kavriel]);
		assert.ok(csv);
		assert.equal(csv.name, 'bank-2026-03.csv');
		assert.match(csv.content, /E-01,Kavriel Tan/);
		assert.equal(payable('ON_HOLD', '6500.00'), false);
		assert.equal(payable('DRAFT', '0'), false);
	});

	it('L-TPL-hr-payroll-137 emits one payslip CSV per employee next to the bank file', () => {
		const docs = payrollExportDocuments({
			payer: { bank_code: 'DBSSSGSG' },
			period: '2026-03',
			payments: [kavriel]
		});
		assert.equal(docs.length, 2);
		assert.equal(docs[1]?.name, 'payslip-E-01-2026-03.csv');
		assert.match(docs[1]?.content ?? '', /BASIC,6500.00/);
		assert.equal(payslipDocument(kavriel).name, 'payslip-E-01-2026-03.csv');
	});
});
