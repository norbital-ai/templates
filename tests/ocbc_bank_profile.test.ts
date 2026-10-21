import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@effect/vitest';
import { Schema } from 'effect';
import { readRows } from '../seed/seed.ts';
import { bankConfigurationRefusal } from '../src/lib/bank_template.ts';
import { bankExportDocuments } from '../src/lib/payroll_engine/bank_export.ts';

const SeededBank = Schema.Struct({
	code: Schema.String,
	name: Schema.String,
	bank_codes: Schema.Array(Schema.String),
	currencies: Schema.Array(Schema.String),
	enabled: Schema.Boolean,
	template: Schema.Record(Schema.String, Schema.Json)
});
const [seeded] = readRows(fileURLToPath(new URL('../seed/bank.json', import.meta.url))).filter(
	(row) => row['code'] === 'OCBC_SG_FAST'
);
const bank = Schema.decodeUnknownSync(SeededBank)(seeded);
type BankInput = Parameters<typeof bankExportDocuments>[0];
const row = {
	employee: { name: 'Example Person' },
	contract: {
		employee_number: 'EXAMPLE-01',
		bank: {
			bank_code: 'TESTSGSGXXX',
			bank_account_number: '000123456789',
			bank_account_name: 'EXAMPLE ACCOUNT HOLDER'
		}
	},
	slips: [
		{
			period: '2026-03',
			status: 'DRAFT',
			gross: 1234.56,
			net: 1234.56,
			total_deductions: 0
		}
	]
};
const input: BankInput = {
	bank,
	templates: [],
	runs: [{ period: '2026-03', pay_date: '2026-03-31' }],
	rows: [row],
	company: {
		disbursement_account: {
			bank_code: 'OCBCSGSGXXX',
			bank_account_number: '000999999999',
			bank_account_name: 'EXAMPLE COMPANY'
		}
	},
	currency: 'SGD',
	generated_at: '2026-03-30T12:00:00.000Z'
};
const withBank = (account: typeof row.contract.bank): BankInput => ({
	...input,
	rows: [{ ...row, contract: { ...row.contract, bank: account } }]
});
const withNet = (net: number): BankInput => ({
	...input,
	rows: [{ ...row, slips: [{ ...row.slips[0], net }] }]
});
const rendered = (held: BankInput): readonly string[] => {
	const result = bankExportDocuments(held);
	assert.equal(result.issue, null);
	assert.equal(result.documents.length, 1);
	return result.documents[0]!.content.split('\n');
};

const spaces = (count: number) => ' '.repeat(count);

describe('OCBC Singapore FAST payroll bank format (public catalogue default)', () => {
	it('is a complete, enabled SGD format for the OCBC paying account', () => {
		assert.equal(bank.enabled, true);
		assert.deepEqual(bank.bank_codes, ['OCBCSGSGXXX']);
		assert.deepEqual(bank.currencies, ['SGD']);
		assert.equal(bankConfigurationRefusal(bank), undefined);
	});

	it('renders the owner sample layout byte for byte: 1,000-character header and details, LF, no trailer', () => {
		const second = {
			...row,
			employee: { name: 'Second Example' },
			contract: {
				employee_number: 'EXAMPLE-02',
				bank: {
					bank_code: 'EXMPSGSGXXX',
					bank_account_number: '1234567890',
					bank_account_name: 'SECOND EXAMPLE'
				}
			},
			slips: [{ ...row.slips[0], net: 98765.4 }]
		};
		const result = bankExportDocuments({ ...input, rows: [row, second] });
		assert.equal(result.issue, null);
		assert.equal(result.documents.length, 1);
		const header =
			'30' + // transaction type
			spaces(3) + // batch number
			'20260330' + // submission date YYYYMMDD
			'OCBCSGSGXXX' + // originating BIC
			'000999999999' +
			spaces(22) + // company account (34)
			spaces(147) +
			'FAST' + // clearing
			spaces(16) + // company reference
			'31032026' + // value date DDMMYYYY
			spaces(767);
		const detail = (bic: string, account: string, holder: string, cents: string) =>
			bic +
			account.padEnd(34) +
			holder.padEnd(35) +
			spaces(108) +
			cents + // amount in cents, 17 zero-filled
			spaces(35) +
			'SALA' + // purpose code
			spaces(756);
		const expected = [
			header,
			detail('TESTSGSGXXX', '000123456789', 'EXAMPLE ACCOUNT HOLDER', '00000000000123456'),
			detail('EXMPSGSGXXX', '1234567890', 'SECOND EXAMPLE', '00000000009876540')
		].join('\n');
		assert.equal(result.documents[0]!.name, 'OCBC-FAST-payroll-2026-03.txt');
		assert.equal(result.documents[0]!.content, expected);
		for (const line of expected.split('\n')) assert.equal(line.length, 1000);
	});

	it('emits one detail per payable employee and preserves account zeroes and single cents', () => {
		const lines = rendered({
			...input,
			rows: [
				row,
				{
					...row,
					contract: {
						...row.contract,
						employee_number: 'EXAMPLE-02',
						bank: { ...row.contract.bank, bank_account_number: '0'.repeat(33) + '1' }
					},
					slips: [{ ...row.slips[0], net: 0.01 }]
				}
			]
		});
		assert.equal(lines.length, 3);
		assert.equal(lines[2]!.slice(11, 45), '0'.repeat(33) + '1');
		assert.equal(lines[2]!.slice(188, 205), '00000000000000001');
		for (const line of lines) assert.equal(line.length, 1000);
	});

	it('refuses missing, malformed, foreign, or branch-specific beneficiary BICs', () => {
		for (const bank_code of ['', 'TESTSGSG', 'TESTMYSGXXX', 'TESTSGSG001']) {
			const result = bankExportDocuments(withBank({ ...row.contract.bank, bank_code }));
			assert.notEqual(result.issue, null);
			assert.deepEqual(result.documents, []);
		}
	});

	it('refuses non-ASCII or overlong FAST names and account-number changes by truncation', () => {
		for (const bank_account_name of ['ÉXAMPLE', 'X'.repeat(36), 'EXAMPLE\nHOLDER']) {
			const result = bankExportDocuments(withBank({ ...row.contract.bank, bank_account_name }));
			assert.notEqual(result.issue, null);
			assert.deepEqual(result.documents, []);
		}
		for (const bank_account_number of ['1'.repeat(35), '000-123', '000 123']) {
			const result = bankExportDocuments(withBank({ ...row.contract.bank, bank_account_number }));
			assert.notEqual(result.issue, null);
			assert.deepEqual(result.documents, []);
		}
	});

	it('keeps exact cents and enforces the SGD 200,000 FAST ceiling', () => {
		assert.equal(rendered(withNet(200000))[1]!.slice(188, 205), '00000000020000000');
		for (const net of [0, -0.01, 0.001, 123.456, 200000.01]) {
			const result = bankExportDocuments(withNet(net));
			assert.notEqual(result.issue, null);
			assert.deepEqual(result.documents, []);
		}
	});

	it('rejects invalid dates, unsupported currency, multiple runs and held payments', () => {
		const inputs: readonly BankInput[] = [
			{ ...input, runs: [{ period: '2026-03', pay_date: '2026-02-30' }] },
			{ ...input, currency: 'MYR' },
			{ ...input, runs: [...input.runs, ...input.runs] },
			{ ...input, rows: [{ ...row, slips: [{ ...row.slips[0], status: 'ON_HOLD' }] }] }
		];
		for (const held of inputs) {
			const result = bankExportDocuments(held);
			assert.notEqual(result.issue, null);
			assert.deepEqual(result.documents, []);
		}
	});
});
