import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { bankExportDocuments } from '../src/lib/payroll_engine/bank_export.ts';

const template = {
	code: 'bank_synthetic',
	rules: {
		bank_file_verified: true,
		bank_file_currencies: ['TEST'],
		file: '"payments.txt"',
		format: 'FIXED',
		columns: [
			{ header: 'account', value: 'contract.bank.bank_account_number', width: 12 },
			{
				header: 'amount',
				value: 'string(int(totals.net * 100.0))',
				width: 8,
				align: 'right',
				pad: '0'
			}
		]
	}
};
const row = {
	employee: { name: 'Example Employee' },
	contract: {
		employee_number: 'EXAMPLE-01',
		bank: {
			bank_code: 'TESTBANK',
			bank_account_number: '000123456789',
			bank_account_name: 'Example Employee'
		}
	},
	slips: [{ period: '2026-03', status: 'DRAFT', gross: 123.45, net: 123.45, total_deductions: 0 }]
};
const input = {
	templates: [template],
	runs: [{ period: '2026-03', pay_date: '2026-03-31' }],
	rows: [row],
	company: {
		disbursement_account: {
			bank_code: 'TESTPAYER',
			bank_account_number: '000999999999',
			bank_account_name: 'Example Company'
		}
	},
	currency: 'TEST',
	generated_at: '2026-03-30T00:00:00.000Z'
};

describe('bank export admission', () => {
	it('requires an evaluated safe basename rather than silently flattening a template path', () => {
		for (const name of [
			'',
			' ',
			'.',
			'..',
			'../payments.txt',
			'folder/payments.txt',
			'folder\\payments.txt',
			'/payments.txt',
			'payments\n.txt',
			'payments?.txt',
			'payments.txt.',
			' payments.txt'
		]) {
			const result = bankExportDocuments({
				...input,
				templates: [{ ...template, rules: { ...template.rules, file: JSON.stringify(name) } }]
			});
			assert.match(result.issue ?? '', /nonempty file name/);
			assert.deepEqual(result.documents, []);
		}
		assert.match(
			bankExportDocuments({
				...input,
				templates: [{ ...template, rules: { ...template.rules, file: '123' } }]
			}).issue ?? '',
			/nonempty file name/
		);
	});
	it('uses a selected shared bank exclusively and refuses currency, payer and draft mismatches', () => {
		const bank = {
			code: 'SHARED-TEST',
			name: 'Shared synthetic format',
			bank_codes: ['TESTPAYER'],
			currencies: ['SGD'],
			enabled: true,
			template: template.rules
		};
		const configured = { ...input, bank, currency: 'SGD', templates: [] };
		assert.equal(bankExportDocuments(configured).issue, null);
		assert.match(
			bankExportDocuments({ ...configured, currency: 'PHP' }).issue ?? '',
			/does not support PHP/
		);
		assert.match(
			bankExportDocuments({ ...configured, bank: { ...bank, bank_codes: ['OTHER'] } }).issue ?? '',
			/does not match/
		);
		assert.match(
			bankExportDocuments({
				...configured,
				bank: { ...bank, enabled: false },
				templates: [template]
			}).issue ?? '',
			/draft payment-file format/
		);
		assert.deepEqual(
			bankExportDocuments({
				...configured,
				bank: { ...bank, enabled: false },
				templates: [template]
			}).documents,
			[]
		);
	});

	it('refuses an empty payment file', () => {
		assert.match(bankExportDocuments({ ...input, rows: [] }).issue ?? '', /no payable employees/);
		assert.deepEqual(bankExportDocuments({ ...input, rows: [] }).documents, []);
	});

	it('requires explicit currency support and includes currency in layout selection', () => {
		assert.match(
			bankExportDocuments({ ...input, currency: 'OTHER' }).issue ?? '',
			/payment currency/
		);
		const selected = bankExportDocuments({
			...input,
			templates: [{ ...template, rules: { ...template.rules, applies_when: 'currency == "TEST"' } }]
		});
		assert.equal(selected.issue, null);
		assert.equal(selected.documents.length, 1);
	});

	it('renders an explicitly verified profile while preserving leading account zeroes and cents', () => {
		const result = bankExportDocuments(input);
		assert.equal(result.issue, null);
		assert.deepEqual(result.documents, [{ name: 'payments.txt', content: '00012345678900012345' }]);
	});

	it('refuses missing payer and beneficiary details and invalid payment dates', () => {
		assert.match(bankExportDocuments({ ...input, company: {} }).issue ?? '', /Company bank code/);
		assert.match(
			bankExportDocuments({ ...input, rows: [{ ...row, contract: {} }] }).issue ?? '',
			/employee bank code/
		);
		assert.match(
			bankExportDocuments({ ...input, runs: [{ period: '2026-03', pay_date: '2026-02-30' }] })
				.issue ?? '',
			/valid payroll payment date/
		);
	});

	it('refuses account or amount overflow without returning a truncated payment file', () => {
		const account = bankExportDocuments({
			...input,
			rows: [
				{
					...row,
					contract: {
						...row.contract,
						bank: { ...row.contract.bank, bank_account_number: '0001234567890' }
					}
				}
			]
		});
		assert.match(account.issue ?? '', /cannot fit account/);
		assert.deepEqual(account.documents, []);
		const amount = bankExportDocuments({
			...input,
			rows: [{ ...row, slips: [{ ...row.slips[0], net: 1234567.89 }] }]
		});
		assert.match(amount.issue ?? '', /cannot fit amount/);
		assert.deepEqual(amount.documents, []);
	});

	it('requires one matching upload profile and refuses control characters', () => {
		assert.match(
			bankExportDocuments({ ...input, templates: [] }).issue ?? '',
			/No bank-file layout/
		);
		assert.match(
			bankExportDocuments({ ...input, templates: [template, template] }).issue ?? '',
			/More than one/
		);
		assert.match(
			bankExportDocuments({
				...input,
				templates: [
					{
						...template,
						rules: {
							...template.rules,
							columns: [{ header: 'name', value: 'employee.name', width: 35 }]
						}
					}
				],
				rows: [{ ...row, employee: { name: 'Example\nEmployee' } }]
			}).issue ?? '',
			/control character/
		);
		assert.match(
			bankExportDocuments({
				...input,
				company: {
					disbursement_account: {
						...input.company.disbursement_account,
						bank_account_name: 'Example\nCompany'
					}
				}
			}).issue ?? '',
			/control character/
		);
	});

	it('refuses a layout that drops a payable employee or pads a field with a newline', () => {
		assert.match(
			bankExportDocuments({
				...input,
				templates: [{ ...template, rules: { ...template.rules, when: 'false' } }]
			}).issue ?? '',
			/excludes a payable employee/
		);
		assert.match(
			bankExportDocuments({
				...input,
				templates: [
					{
						...template,
						rules: {
							...template.rules,
							columns: [
								{
									header: 'account',
									value: 'contract.bank.bank_account_number',
									width: 15,
									pad: '\n'
								}
							]
						}
					}
				]
			}).issue ?? '',
			/invalid padding character/
		);
	});
});
