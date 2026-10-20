import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from '@effect/vitest';
import { Schema } from 'effect';
import { bankExportDocuments } from '../src/lib/payroll_engine/bank_export.ts';
import { recordDocuments } from '../src/lib/payroll_engine/export.ts';

const Field = Schema.Struct({
	header: Schema.String,
	value: Schema.String,
	width: Schema.Number,
	align: Schema.optional(Schema.Literals(['left', 'right'])),
	pad: Schema.optional(Schema.String)
});
const Validation = Schema.Struct({ test: Schema.String, message: Schema.String });
const Candidate = Schema.Struct({
	code: Schema.String,
	name: Schema.String,
	rules: Schema.Struct({
		description: Schema.String,
		bank_file_verified: Schema.Boolean,
		bank_file_currencies: Schema.Array(Schema.String),
		bank_file_validation: Schema.Struct({
			file: Schema.Array(Validation),
			row: Schema.Array(Validation)
		}),
		applies_when: Schema.String,
		file: Schema.String,
		format: Schema.Literal('FIXED'),
		when: Schema.String,
		header: Schema.Array(Field),
		columns: Schema.Array(Field)
	})
});
const candidate = Schema.decodeUnknownSync(Candidate)(
	JSON.parse(
		readFileSync(new URL('./fixtures/ocbc_girofastwithinv_candidate.json', import.meta.url), 'utf8')
	)
);
// Only synthetic tests override this flag; the candidate fixture remains disabled.
const verifiedSynthetic = {
	...candidate,
	rules: { ...candidate.rules, bank_file_verified: true }
};
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
	templates: [verifiedSynthetic],
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
const withBank = (bank: typeof row.contract.bank): BankInput => ({
	...input,
	rows: [{ ...row, contract: { ...row.contract, bank } }]
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

describe('disabled OCBC Singapore GIROFASTWITHINV FAST payroll candidate', () => {
	it('stays disabled until separately verified by the bank', () => {
		assert.equal(candidate.rules.bank_file_verified, false);
		const result = bankExportDocuments({ ...input, templates: [candidate] });
		assert.match(result.issue ?? '', /not been verified/);
		assert.deepEqual(result.documents, []);
	});

	it('defines the complete 1,000-character header and detail without a trailer', () => {
		assert.equal(
			candidate.rules.header.reduce((total, field) => total + field.width, 0),
			1000
		);
		assert.equal(
			candidate.rules.columns.reduce((total, field) => total + field.width, 0),
			1000
		);
		assert.equal('trailer' in candidate.rules, false);
		const direct = recordDocuments(
			[candidate],
			input.runs,
			input.rows,
			input.company,
			input.generated_at,
			true,
			input.currency
		);
		assert.equal(direct.length, 1);
		assert.equal(direct[0]!.name, 'OCBC-FAST-payroll-2026-03.txt');
		const lines = direct[0]!.content.split('\n');
		assert.equal(lines.length, 2);
		for (const line of lines) assert.equal(Buffer.byteLength(line, 'ascii'), 1000);
		const header = lines[0]!;
		assert.equal(header.slice(0, 2), '30');
		assert.equal(header.slice(2, 5), '   ');
		assert.equal(header.slice(5, 13), '20260330');
		assert.equal(header.slice(13, 24), 'OCBCSGSGXXX');
		assert.equal(header.slice(24, 58), '000999999999'.padEnd(34));
		assert.equal(header.slice(58, 205), ' '.repeat(147));
		assert.equal(header.slice(205, 209), 'FAST');
		assert.equal(header.slice(209, 225), ' '.repeat(16));
		assert.equal(header.slice(225, 233), '31032026');
		assert.equal(header.slice(233), ' '.repeat(767));
		const detail = lines[1]!;
		assert.equal(detail.slice(0, 11), 'TESTSGSGXXX');
		assert.equal(detail.slice(11, 45), '000123456789'.padEnd(34));
		assert.equal(detail.slice(45, 80), 'EXAMPLE ACCOUNT HOLDER'.padEnd(35));
		assert.equal(detail.slice(80, 188), ' '.repeat(108));
		assert.equal(detail.slice(188, 205), '00000000000123456');
		assert.equal(detail.slice(205, 240), ' '.repeat(35));
		assert.equal(detail.slice(240, 244), 'SALA');
		assert.equal(detail.slice(244), ' '.repeat(756));
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
