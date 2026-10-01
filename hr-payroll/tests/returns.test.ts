// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Declared returns and bank files (L2): every cell, the population, the record layout and the file
 * name are stored declarations over the `filing` site; `generateReturn` only evaluates and lays out.
 *
 * The fixed-width golden is the 1000-character bank upload the former hand-coded formatter wrote,
 * now stated as a declaration: its bytes are the ones the bank's own reference file carries
 * (3104 bytes for two payments). The return golden is hand-computed from the slips below.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	bankFileDeclaration,
	filingGroups,
	filingPeriod,
	generateReturn
} from '../src/lib/payroll/run/returns.ts';
import { returnsFault } from '../src/lib/datatypes/returns.ts';

const COMPANY = { settings_code: 'FIXTURE', name: 'Fixture Pte', facts: { employer_ref: 'E-001' } };

const slip = ({ employee, employment = `${employee}:1`, number, name, id, lines, fund }) => ({
	employmentId: employment,
	employeeNumber: number,
	currency: 'XXX',
	designation: null,
	section: null,
	group: null,
	employeeName: name,
	identityNumber: id,
	hireDate: '2025-01-01',
	lastDay: null,
	person: {
		employeeId: employee,
		dateOfBirth: null,
		gender: null,
		nationality: null,
		departureOn: null
	},
	attendance: { normalHours: 0, actualHours: 0, shiftCodes: [] },
	gross: lines.reduce((t, [, bucket, amount]) => t + (bucket === 'ABSENCE' ? -amount : amount), 0),
	totalDeductions: fund,
	net: 0,
	unfundedContributions: 0,
	fundingReceived: 0,
	employerCost: 0,
	lines: lines.map(([componentCode, bucket, amount]) => ({
		componentCode,
		bucket,
		family: 'BASE',
		amount
	})),
	contributions: new Map([['FUND', { base: 0, employee: fund, employer: 0 }]])
});

// ---------------------------------------------------------------------------------------------
// A fixed-width bank upload, byte for byte.

const PAYER = {
	code: 'OCBCSGSGXXX',
	account: '701433716001',
	holder: 'NORBITAL PTE. LTD.',
	bank_name: 'B'
};

let filler = 0;
const fixed = (width, value = "''") => ({ key: `f${(filler += 1)}`, value, width });
const BANK_FILE = {
	code: 'PAYER_FIXED',
	cadence: 'EVENT',
	payer_bank: '^OCBCSG',
	columns: [
		{ key: 'bic', value: 'bank.code', width: 11, pattern: '^.{11}$' },
		{
			key: 'account',
			value: "bank.account.split('-').join().split(' ').join()",
			width: 9,
			align: 'RIGHT',
			pad: '0',
			pattern: '^[0-9]+$'
		},
		fixed(25),
		{ key: 'name', value: 'bank.holder', width: 143, truncate: true },
		{
			key: 'amount',
			value: "string(int(round(totals.net * 100.0, 1.0, 'HALF_UP')))",
			width: 17,
			align: 'RIGHT',
			pad: '0'
		},
		fixed(35),
		fixed(4, "'SALA'"),
		fixed(756)
	],
	header_records: [
		{
			columns: [
				fixed(13, "'3' + '0095' + filing.pay_date.split('-').join()"),
				{ key: 'payer_bic', value: 'payer.code', width: 11, pattern: '^.{11}$' },
				{ key: 'payer_account', value: 'payer.account', width: 181, pattern: '^[0-9]+$' },
				fixed(20, "'FAST'"),
				fixed(
					8,
					'filing.pay_date.substring(8, 10) + filing.pay_date.substring(5, 7) + filing.pay_date.substring(0, 4)'
				),
				fixed(767)
			]
		}
	],
	trailer_records: [{ columns: [fixed(3)] }, { columns: [fixed(97)] }],
	format: {
		kind: 'FIXED',
		line_end: 'LF',
		name: "'bank_' + filing.pay_date.split('-').join() + '.txt'"
	}
};

const payment = (number, holder, account, net) => ({
	payee: { employee_number: number, name: holder, identity_number: '' },
	bank: { code: 'DBSSSGSGXXX', account, holder },
	slips: [
		{
			period: '2026-09',
			pay_date: '2026-09-12',
			gross: net,
			net,
			lines: {},
			classes: {},
			base: {},
			employee: {},
			employer: {}
		}
	]
});

const bankFile = (payments, pay_date = '2026-09-12') =>
	generateReturn({
		declaration: BANK_FILE,
		filing: { code: BANK_FILE.code, period: pay_date.slice(0, 7), year: 2026, pay_date },
		company: COMPANY,
		payer: PAYER,
		groups: payments,
		currency: 'XXX'
	});

test('a declared fixed-width bank file reproduces the upload layout byte for byte', () => {
	const file = bankFile([
		payment('N0001', 'Dion Neo Wen Shun', '093912632', 4000),
		payment('N0002', 'Zuyao Liu', '244309518', 2400)
	]);
	assert.equal(file.name, 'bank_20260912.txt');
	assert.equal(file.mime, 'text/plain');
	assert.equal(file.rows, 2);
	const records = file.text.split('\n');
	assert.equal(records.length, 5, 'one header, one record per payment, the two trailer records');
	const [header, first, second] = records;
	for (const record of [header, first, second]) assert.equal(record.length, 1000);
	assert.equal(header.slice(0, 36), '3009520260912OCBCSGSGXXX701433716001');
	assert.equal(header.slice(205, 209), 'FAST');
	assert.equal(header.slice(225, 233), '12092026');
	assert.equal(first.slice(0, 20), 'DBSSSGSGXXX093912632');
	assert.equal(first.slice(45, 62), 'Dion Neo Wen Shun');
	assert.equal(first.slice(188, 205), '00000000000400000');
	assert.equal(first.slice(240, 244), 'SALA');
	assert.equal(second.slice(0, 20), 'DBSSSGSGXXX244309518');
	assert.equal(second.slice(188, 205), '00000000000240000');
	// 3 × 1000 + 4 newlines + 3 + 97, no final newline.
	assert.equal(file.text.length, 3_104);
	assert.equal(records[3], '   ');
	assert.equal(records[4], ' '.repeat(97));
});

test('a fixed-width amount keeps its cents and a short account is left-padded', () => {
	const [header, first] = bankFile(
		[payment('N0002', 'Zuyao Liu', '9192632', 1036.36)],
		'2026-06-19'
	).text.split('\n');
	assert.equal(header.slice(225, 233), '19062026');
	assert.equal(first.slice(11, 20), '009192632');
	assert.equal(first.slice(188, 205), '00000000000103636');
});

test('a value that breaks its declared layout is refused, not shifted into the next field', () => {
	assert.throws(
		() =>
			bankFile([
				{
					...payment('N0001', 'A', '093912632', 1),
					bank: { code: 'DBSSSGSG', account: '1', holder: 'A' }
				}
			]),
		/does not match the declared layout/
	);
	assert.throws(
		() => bankFile([payment('N0001', 'A', '093-912-632X', 1)]),
		/does not match the declared layout/
	);
	assert.throws(
		() => bankFile([payment('N0001', 'A', '1234567890', 1)]),
		/longer than its 9 characters/
	);
});

test('the payer bank picks its declared layout; any other payer keeps the generic listing', () => {
	assert.equal(bankFileDeclaration([BANK_FILE], 'ocbcsgsgxxx')?.code, 'PAYER_FIXED');
	assert.equal(bankFileDeclaration([BANK_FILE], 'MBBEMYKLXXX'), null);
});

// ---------------------------------------------------------------------------------------------
// A yearly CSV return over two runs.

const RETURN = {
	code: 'YEAR_RETURN',
	cadence: 'YEAR',
	population: 'totals.gross > 0.0',
	identity_patterns: [
		{ type: 'PASSPORT', pattern: '^P\\d{4}$' },
		{ type: 'NATIONAL', pattern: '^N\\d{6}$' }
	],
	columns: [
		{ key: 'id', label: 'ID', value: 'payee.identity_number' },
		{ key: 'id_type', label: 'Type', value: 'payee.identity_type' },
		{ key: 'name', label: 'Name', value: 'payee.name' },
		{ key: 'gross', label: 'Gross', value: 'totals.gross' },
		{ key: 'bonus', label: 'Bonus', value: 'totals.lines.BONUS' },
		{ key: 'fund', label: 'Fund', value: 'totals.employee.FUND' },
		{ key: 'slips', label: 'Slips', value: 'totals.slips' }
	],
	trailer_records: [
		{
			columns: [
				{ key: 't', value: "'TOTAL'" },
				{ key: 'ref', value: 'company.facts.employer_ref' },
				{ key: 'rows', value: 'filing.rows' },
				{ key: 'gross', value: 'totals.gross' }
			]
		}
	],
	format: { kind: 'CSV', header: true }
};

const A = { employee: 'a', number: 'N0001', name: 'Tan, Ah Kow', id: 'P1234' };
const B = { employee: 'b', number: 'N0002', name: 'Lee Mei', id: 'N123456' };
const C = { employee: 'c', number: 'N0003', name: 'Unpaid', id: 'bad' };
const runs = [
	{
		period: '2026-02',
		payDate: '2026-02-28',
		payslips: [
			slip({
				...A,
				lines: [
					['BASIC', 'EARNING', 3000],
					['BONUS', 'EARNING', 1500.5]
				],
				fund: 900.1
			}),
			slip({
				...B,
				lines: [
					['BASIC', 'EARNING', 2000],
					['ABSENCE', 'ABSENCE', 100]
				],
				fund: 380
			}),
			slip({ ...C, lines: [], fund: 0 })
		],
		bank: []
	},
	{
		period: '2026-01',
		payDate: '2026-01-31',
		payslips: [slip({ ...A, lines: [['BASIC', 'EARNING', 3000]], fund: 600 })],
		bank: []
	}
];

const yearReturn = (declaration = RETURN) =>
	generateReturn({
		declaration,
		filing: { code: declaration.code, period: '2026', year: 2026, pay_date: '2026-02-28' },
		company: COMPANY,
		payer: null,
		groups: filingGroups(runs, false),
		currency: 'XXX'
	});

test('a yearly return sums each person’s slips, names absent lines 0 and leaves out the population', () => {
	// A: 3000 + 3000 + 1500.50 = 7500.50, fund 600 + 900.10 = 1500.10, two slips.
	// B: 2000 − 100 absence = 1900, no bonus line → 0, fund 380. C: gross 0, outside the population
	// (its unmatched identity is therefore not refused). Trailer: 7500.50 + 1900 = 9400.50 over 2 rows.
	const file = yearReturn();
	assert.equal(file.name, 'year_return_2026.csv');
	assert.equal(file.rows, 2);
	assert.equal(
		file.text,
		[
			'ID,Type,Name,Gross,Bonus,Fund,Slips',
			'P1234,PASSPORT,"Tan, Ah Kow",7500.5,1500.5,1500.1,2',
			'N123456,NATIONAL,Lee Mei,1900,0,380,1',
			'TOTAL,E-001,2,9400.5'
		].join('\r\n')
	);
});

test('a filed row whose identity matches no declared type is refused', () => {
	assert.throws(
		() => yearReturn({ ...RETURN, population: null }),
		/N0003: YEAR_RETURN identifies the employee by PASSPORT or NATIONAL/
	);
});

test('a scope key matches the duty ledger’s occurrence refs', () => {
	assert.equal(filingPeriod('EVENT', '2026-05'), '2026-05');
	assert.equal(filingPeriod('MONTH', '2026-05'), '2026-05');
	assert.equal(filingPeriod('QUARTER', '2026-05'), '2026-Q2');
	assert.equal(filingPeriod('QUARTER', '2026-12'), '2026-Q4');
	assert.equal(filingPeriod('YEAR', '2026-05'), '2026');
});

test('a declaration is refused for a duplicate code, a width-less fixed field or a bank file on a month', () => {
	const column = { key: 'x', value: "'x'" };
	const base = { code: 'R', cadence: 'EVENT', columns: [column], format: { kind: 'CSV' } };
	assert.equal(returnsFault([base]), undefined);
	assert.match(returnsFault([base, base]), /declared once/);
	assert.match(returnsFault([{ ...base, format: { kind: 'FIXED' } }]), /states its width/);
	assert.match(returnsFault([{ ...base, cadence: 'MONTH', payer_bank: '^X' }]), /cadence is EVENT/);
});
