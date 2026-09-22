// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The OCBC FAST formatter against an actual Velocity upload file: the fixed offsets, the 17-digit
 * amount, the nine-digit account and the 1000-character record length are the bank's, not ours.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bankFileFor, ocbcFastFile } from '../src/collections/payroll_runs/lib/bank-formats.ts';

const payer = {
	bank_name: 'OVERSEA-CHINESE BANKING CORPORATION LIMITED',
	bank_code: 'OCBCSGSGXXX',
	bank_account_number: '701433716001',
	bank_account_name: 'NORBITAL PTE. LTD.'
};

const payments = [
	{
		employeeNumber: 'N0001',
		currency: 'SGD',
		net: 4000,
		bank: {
			account_name: 'Dion Neo Wen Shun',
			bank_code: 'DBSSSGSGXXX',
			bank_name: 'DBS BANK LTD',
			account_number: '093912632'
		}
	},
	{
		employeeNumber: 'N0002',
		currency: 'SGD',
		net: 2400,
		bank: {
			account_name: 'Zuyao Liu',
			bank_code: 'DBSSSGSGXXX',
			bank_name: 'DBS BANK LTD',
			account_number: '244309518'
		}
	}
];

test('the OCBC FAST file reproduces the bank upload layout byte for byte', () => {
	const file = ocbcFastFile({
		payDate: '2026-09-12',
		period: '2026-09',
		payer,
		payments,
		fileSequence: '0095'
	});
	assert.equal(file.name, 'ocbc_fast_20260912.txt');
	assert.equal(file.contentType, 'TEXT');
	const content = String(file.content);
	const records = content.split('\n');
	assert.equal(records.length, 5, 'one header, one record per payment, and the trailer');
	const [header, first, second] = records;
	for (const record of [header, first, second])
		assert.equal(record.length, 1000, 'every bank record is 1000 characters');
	assert.equal(header.slice(0, 36), '3009520260912OCBCSGSGXXX701433716001');
	assert.equal(header.slice(205, 209), 'FAST');
	assert.equal(header.slice(225, 233), '12092026');

	assert.equal(first.slice(0, 20), 'DBSSSGSGXXX093912632');
	assert.equal(first.slice(45, 62), 'Dion Neo Wen Shun');
	assert.equal(first.slice(188, 205), '00000000000400000');
	assert.equal(first.slice(240, 244), 'SALA');

	assert.equal(second.slice(0, 20), 'DBSSSGSGXXX244309518');
	assert.equal(second.slice(45, 54), 'Zuyao Liu');
	assert.equal(second.slice(188, 205), '00000000000240000');
	assert.equal(second.slice(240, 244), 'SALA');

	// The bank's own file for these payments is 3104 bytes: three 1000-character records, three
	// newlines, and the 101-byte trailer (`'   \n'` + 97 spaces) every reference file ends with.
	assert.equal(content.length, 3_104);
	assert.equal(records[3], '   ', 'the trailer opens with its blank three-character field');
	assert.equal(records[4], ' '.repeat(97), 'and closes with 97 blank characters, no newline');
});

test('a bank code that is not an 11-character BIC is refused, not shifted into the next field', () => {
	assert.throws(
		() =>
			ocbcFastFile({
				payDate: '2026-09-12',
				period: '2026-09',
				payer,
				payments: [{ ...payments[0], bank: { ...payments[0].bank, bank_code: 'DBSSSGSG' } }]
			}),
		/11-character BIC/
	);
});

test('an account number normalising would rewrite is refused, not silently changed', () => {
	assert.throws(
		() =>
			ocbcFastFile({
				payDate: '2026-09-12',
				period: '2026-09',
				payer,
				payments: [
					{ ...payments[0], bank: { ...payments[0].bank, account_number: '093-912-632X' } }
				]
			}),
		/numeric account/
	);
});

test('an amount keeps its cents and a short account is left-padded to nine digits', () => {
	const [header, first] = String(
		ocbcFastFile({
			payDate: '2026-06-19',
			period: '2026-06',
			payer,
			payments: [
				{ ...payments[1], net: 1036.36, bank: { ...payments[1].bank, account_number: '9192632' } }
			],
			fileSequence: '0029'
		}).content
	).split('\n');
	assert.equal(header.slice(225, 233), '19062026');
	assert.equal(first.slice(11, 20), '009192632');
	assert.equal(first.slice(188, 205), '00000000000103636');
});

test('the registry names a formatter only for the banks it holds, and no others', () => {
	assert.equal(
		bankFileFor({ payDate: '2026-09-12', period: '2026-09', payer, payments })?.format,
		'ocbc-fast'
	);
	assert.equal(
		bankFileFor({
			payDate: '2026-09-12',
			period: '2026-09',
			payer: { ...payer, bank_code: 'MBBEMYKLXXX' },
			payments
		}),
		null,
		'a payer bank with no formatter keeps the generic listing'
	);
});
