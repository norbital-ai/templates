/** L-TPL-hr-payroll-137 bank CSV, the OCBC FAST record and per-employee payslip CSV. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
	bankDocument,
	exportEntries,
	exportSlip,
	payable,
	payrollExportDocuments,
	moneyText,
	payslipDocument,
	payslipLines,
	recordDocuments
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
	it('L-TPL-hr-payroll-137 writes the bank CSV; held and non-positive nets are left out', () => {
		const csv = bankDocument('2026-03', [kavriel]);
		assert.ok(csv);
		assert.equal(csv.name, 'bank-2026-03.csv');
		assert.match(csv.content, /E-01,Kavriel Tan/);
		assert.equal(payable('ON_HOLD', '6500.00'), false);
		assert.equal(payable('DRAFT', '0'), false);
	});

	it('the OCBC FAST layout is the SG EXPORTS record, made only for an OCBC payer', () => {
		const rows: { code: string; family: string; rules: unknown }[] = JSON.parse(
			readFileSync(
				new URL('../seed/jurisdiction/SG/version_4/rule_set.json', import.meta.url),
				'utf8'
			)
		);
		const fast = rows.find((row) => row.code === 'bank_ocbc_fast');
		assert.equal(fast?.family, 'EXPORTS');
		const render = (bank_code: string) =>
			recordDocuments(
				[{ code: 'bank_ocbc_fast', rules: fast!.rules }],
				[{ period: '2026-03', pay_date: '2026-03-31' }],
				[
					{
						employee: { name: 'Kavriel Tan' },
						contract: { employee_number: 'E-01', bank: { bank_account_number: '123456789' } },
						slips: [
							{ period: '2026-03', status: 'DRAFT', gross: 6500, net: 6500, total_deductions: 0 }
						]
					},
					{
						employee: { name: 'Held' },
						contract: { employee_number: 'E-02' },
						slips: [
							{ period: '2026-03', status: 'ON_HOLD', gross: 10, net: 10, total_deductions: 0 }
						]
					}
				],
				{
					disbursement_account: {
						bank_code,
						bank_account_number: '999',
						bank_account_name: 'Acme Pte Ltd'
					}
				}
			);
		const [file] = render('OCBCSGSGXXX');
		assert.equal(file?.name, 'bank-2026-03.fast.txt');
		assert.equal(
			file?.content,
			[
				`0${'999'.padEnd(20)}${'ACME PTE LTD'.padEnd(35)}20260331`,
				`1${'123456789'.padEnd(34)}000000650000${'KAVRIEL TAN'.padEnd(35)}${'E-01'.padEnd(16)}`,
				`9000001${'650000'.padStart(18, '0')}`
			].join('\n')
		);
		assert.deepEqual(render('DBSSSGSGXXX'), []);
	});

	it('L-TPL-hr-payroll-137 emits one payslip CSV per employee next to the bank file', () => {
		const docs = payrollExportDocuments({
			period: '2026-03',
			payments: [kavriel]
		});
		assert.equal(docs.length, 2);
		assert.equal(docs[1]?.name, 'payslip-E-01-2026-03.csv');
		assert.match(docs[1]?.content ?? '', /BASIC,6500.00/);
		assert.equal(payslipDocument(kavriel).name, 'payslip-E-01-2026-03.csv');
	});

	it('amounts print at the currency minor units: IDR whole rupiah, SGD two places', () => {
		const idr = {
			...kavriel,
			currency: 'IDR',
			amount: '1500000.00',
			gross: '1500000.00',
			lines: [{ component_code: 'BASIC', amount: '1500000.00' }]
		};
		const [bank, slip] = payrollExportDocuments({ period: '2026-03', payments: [idr], scale: 0 });
		assert.match(bank!.content, /,1500000,IDR$/m);
		assert.doesNotMatch(slip!.content, /\.00/);
		const [sgd] = payrollExportDocuments({ period: '2026-03', payments: [kavriel], scale: 2 });
		assert.match(sgd!.content, /,6500\.00,SGD$/m);
	});

	it('a payslip CSV lists the statutory employee shares as deductions', () => {
		const statutory = [
			{ scheme_code: 'EPF', base_amount: 4064.52, employee_amount: 449, employer_amount: 531 },
			{ scheme_code: 'HRDF', base_amount: 4064.52, employee_amount: 0, employer_amount: 40.65 }
		];
		assert.deepEqual(payslipLines(statutory), [{ component_code: 'EPF', amount: '-449' }]);
	});
});

describe('statutory returns as records', () => {
	it('an EXPORTS row renders one CSV row per employment over the selected runs, its columns CEL', () => {
		const template = {
			code: 'ANNUAL_RETURN',
			rules: {
				file: '"annual-return-" + runs[0].period.substring(0, 4) + ".csv"',
				when: 'totals.gross > 0.0',
				columns: [
					{ header: 'TIN', value: 'employee.identity_number' },
					{ header: 'Name', value: 'employee.name' },
					{ header: 'Gross', value: 'totals.gross' },
					{
						header: 'Tax',
						value: 'has(totals.statutory.WHT) ? totals.statutory.WHT.employee : 0.0'
					},
					{ header: 'Months', value: 'size(slips)' }
				]
			}
		};
		const slip = (period: string, gross: number, tax: number) => ({
			period,
			gross,
			net: gross - tax,
			total_deductions: tax,
			lines: { BASIC: gross },
			statutory: { WHT: { employee: tax, employer: 0, base: gross } }
		});
		const [document] = recordDocuments(
			[template],
			[{ period: '2026-01' }, { period: '2026-02' }],
			[
				{
					employee: { name: 'Kavriel, Tan', identity_number: '123-456' },
					contract: { employee_number: 'E-01' },
					slips: [slip('2026-01', 1000, 50), slip('2026-02', 1200, 70)]
				},
				{ employee: { name: 'Nobody' }, contract: {}, slips: [] }
			]
		);
		assert.equal(document?.name, 'annual-return-2026.csv');
		assert.equal(document?.content, 'TIN,Name,Gross,Tax,Months\n123-456,"Kavriel, Tan",2200,120,2');
	});
});

describe('fixed-width returns as records', () => {
	it('a FIXED export pads each column to its width and frames the rows with header and trailer totals', () => {
		const template = {
			code: 'FIXED_RETURN',
			rules: {
				file: '"return.txt"',
				format: 'FIXED',
				header: [
					{ value: '"H"', width: 1 },
					{ value: 'runs[0].period', width: 7 }
				],
				columns: [
					{ header: 'Seq', value: 'index', width: 3, align: 'right', pad: '0' },
					{ header: 'Name', value: 'employee.name', width: 6 },
					{
						header: 'Gross',
						value: 'string(int(totals.gross * 100.0))',
						width: 8,
						align: 'right',
						pad: '0'
					}
				],
				trailer: [
					{ value: '"T"', width: 1 },
					{ value: 'string(count)', width: 3, align: 'right', pad: '0' },
					{
						value: 'string(int(sum(rows.map(r, r.totals.gross)) * 100.0))',
						width: 9,
						align: 'right',
						pad: '0'
					}
				]
			}
		};
		const slip = (gross: number) => ({ period: '2026-03', gross, net: gross, total_deductions: 0 });
		const [document] = recordDocuments(
			[template],
			[{ period: '2026-03' }],
			[
				{ employee: { name: 'Kavriel Tan' }, contract: {}, slips: [slip(1000)] },
				{ employee: { name: 'Lu' }, contract: {}, slips: [slip(25.5)] }
			]
		);
		assert.equal(
			document?.content,
			['H2026-03', '001Kavrie00100000', '002Lu    00002550', 'T002000102550'].join('\n')
		);
		// A CSV return numbers its rows too.
		const [csv] = recordDocuments(
			[
				{
					code: 'CSV',
					rules: { file: '"a.csv"', columns: [{ header: 'No', value: 'string(index)' }] }
				}
			],
			[{ period: '2026-03' }],
			[{ employee: {}, contract: {}, slips: [] }]
		);
		assert.equal(csv?.content, 'No\n1');
	});
});

describe('expanded returns as records', () => {
	it('a row expands into records, a summary record per key totals them, and every record reads the company', () => {
		const template = {
			code: 'CONTRIBUTIONS',
			rules: {
				file: '"contributions.txt"',
				format: 'FIXED',
				header: [{ value: '"H" + company.facts.payer_id', width: 6 }],
				columns: [],
				records: [
					{
						each: 'slips',
						fields: [
							{ value: '"D"', width: 1 },
							{ value: 'item.code', width: 3 },
							{ value: 'string(index)', width: 2, align: 'right', pad: '0' },
							{ value: 'string(int(item.amount))', width: 5, align: 'right', pad: '0' }
						]
					}
				],
				summary: {
					key: 'item.code',
					fields: [
						{ value: '"S"', width: 1 },
						{ value: 'key', width: 3 },
						{ value: 'string(count)', width: 2, align: 'right', pad: '0' },
						{
							value: 'string(int(sum(items.map(i, i.item.amount))))',
							width: 6,
							align: 'right',
							pad: '0'
						}
					]
				},
				trailer: [{ value: '"T" + string(size(items))', width: 3 }]
			}
		};
		const [document] = recordDocuments(
			[template],
			[{ period: '2026-03' }],
			[
				{
					employee: {},
					contract: {},
					slips: [
						{ code: 'AAA', amount: 100 },
						{ code: 'BBB', amount: 20 }
					]
				},
				{ employee: {}, contract: {}, slips: [{ code: 'AAA', amount: 50 }] }
			],
			{ facts: { payer_id: 'P01' } }
		);
		assert.equal(
			document?.content,
			[
				'HP01  ',
				'DAAA0100100',
				'DBBB0100020',
				'DAAA0200050',
				'SAAA02000150',
				'SBBB01000020',
				'T3 '
			].join('\n')
		);
	});
});

describe('money text', () => {
	it('a plain non-integer number keeps its value', () => {
		assert.equal(moneyText(11.25), '11.25');
		assert.equal(moneyText(-0.07), '-0.07');
		assert.equal(moneyText(1200), '1200');
		assert.equal(moneyText('3.5'), '3.5');
		assert.equal(moneyText(Number.NaN), '0');
	});
});

describe('summaries and the generation instant', () => {
	it('a summary goes before the details on request, from its own list, and records read generated_at', () => {
		const template = {
			code: 'SUMMARY_FIRST',
			rules: {
				file: '"s.txt"',
				format: 'FIXED',
				header: [{ value: 'generated_at.substring(0, 10)', width: 10 }],
				columns: [],
				records: [{ each: 'slips', fields: [{ value: '"D" + item.code', width: 4 }] }],
				summary: {
					position: 'before',
					// SDL has no detail record: the summary reads its own list.
					each: 'rows[0].slips.map(s, s.code) + ["SDL"]',
					key: 'item',
					fields: [
						{ value: '"S" + key', width: 4 },
						{ value: 'string(count)', width: 2, align: 'right', pad: '0' }
					]
				}
			}
		};
		const [document] = recordDocuments(
			[template],
			[{ period: '2026-03' }],
			[{ employee: {}, contract: {}, slips: [{ code: 'CPF' }, { code: 'CPF' }] }],
			{},
			'2026-04-01T08:30:00.000Z'
		);
		assert.equal(document?.content, ['2026-04-01', 'SCPF02', 'SSDL01', 'DCPF', 'DCPF'].join('\n'));
	});
});

describe('returns over leave and pinned entries', () => {
	const slip = {
		gross: '1000.00',
		net: '900.00',
		total_deductions: '100.00',
		status: 'PAID',
		leave_catalog_entry: [
			{
				catalog: { code: 'MATERNITY' },
				days: '20',
				from: '2026-03-02',
				to: '2026-03-27',
				facts: { child_id: 'c1' },
				amount: null
			}
		],
		adhoc_catalog_entry: [
			{
				employment_id: 'k1',
				catalog: { code: 'HOUSING' },
				amount: '1200.00',
				quantity: null,
				facts: { residence: 'A' }
			},
			{
				employment_id: 'k1',
				catalog: { code: 'HOUSING' },
				amount: '800.00',
				quantity: null,
				facts: { residence: 'B' }
			}
		],
		claim_catalog_entry: [
			{ employment_id: 'k1', catalog: { code: 'ESOP' }, amount: '50.00', quantity: '10', facts: {} }
		]
	};
	it('a slip carries its leave rows and its pinned entries, by class code', () => {
		assert.deepEqual(exportSlip(slip, '2026-03').leave, [
			{
				code: 'MATERNITY',
				days: 20,
				from: '2026-03-02',
				to: '2026-03-27',
				facts: { child_id: 'c1' }
			}
		]);
		assert.deepEqual(
			exportEntries([slip]).map((row) => [
				row.family,
				row.code,
				row.amount,
				row.quantity,
				row.employment_id
			]),
			[
				['ADHOC', 'HOUSING', 1200, null, 'k1'],
				['ADHOC', 'HOUSING', 800, null, 'k1'],
				['CLAIM', 'ESOP', 50, 10, 'k1'],
				['LEAVE', 'MATERNITY', 0, null, null]
			]
		);
	});
	it('a per-item return expands an employment row by its entries', () => {
		const [document] = recordDocuments(
			[
				{
					code: 'APPENDIX_8A',
					rules: {
						file: '"8a.csv"',
						columns: [
							{ header: 'Name', value: 'employee.name' },
							{ header: 'Residence', value: 'item.facts.residence' },
							{ header: 'Value', value: 'string(item.amount)' }
						],
						records: [
							{
								each: 'entries.filter(e, e.code == "HOUSING")',
								fields: [
									{ value: 'employee.name' },
									{ value: 'item.facts.residence' },
									{ value: 'string(item.amount)' }
								]
							}
						],
						trailer: [{ value: 'string(size(entries))' }]
					}
				}
			],
			[{ period: '2026-03' }],
			[
				{
					employee: { name: 'Lu' },
					contract: {},
					slips: [exportSlip(slip, '2026-03')],
					entries: exportEntries([slip])
				}
			]
		);
		assert.equal(
			document?.content,
			['Name,Residence,Value', 'Lu,A,1200', 'Lu,B,800', '4'].join('\n')
		);
	});
});
