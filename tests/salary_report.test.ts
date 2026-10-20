import assert from 'node:assert/strict';
import { it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import ExcelJS from 'exceljs';
import {
	salaryReport,
	SalaryReportConfiguration,
	type SalaryCatalog,
	type SalaryEmployee
} from '../src/lib/payroll_engine/salary_report.js';
import { salaryWorkbook } from '../src/lib/ui/payroll/salary_report.js';
import { lineage } from './jurisdiction_kit.js';

const profile = (jurisdiction: string) => {
	const law = lineage(jurisdiction);
	const version = law.versions.at(-1);
	assert.ok(version);
	const row = law
		.rows(version, 'rule_set')
		.find((row) => row['family'] === 'PAYROLL' && row['code'] === 'salary_report');
	assert.ok(row, `${jurisdiction}/${version} supplies salary report metadata`);
	return Schema.decodeUnknownSync(SalaryReportConfiguration)(row['rules']);
};

const employee: SalaryEmployee = {
	employee_number: '0007',
	name: 'Test employee',
	status: 'DRAFT',
	bank_charges: 0,
	base: [
		{ component_code: 'BASIC', label: 'Basic salary', amount: 1000 },
		{ component_code: 'MEAL', label: 'Meal allowance', amount: 100 },
		{ component_code: 'OT', label: 'Overtime', amount: 50 }
	],
	adjustments: [
		{
			family: 'ADHOC',
			component_code: 'BONUS',
			label: 'Bonus',
			amount: -10,
			destination: 'PAY',
			source_id: 'bonus-reversal'
		},
		{
			family: 'LOAN_REPAYMENT',
			component_code: 'LOAN_RECOVERY_SSS_SALARY',
			label: 'SSS loan',
			amount: -20,
			destination: 'NET',
			source_id: 'repayment-child'
		},
		{
			family: 'LOAN_REPAYMENT',
			component_code: 'LOAN_RECOVERY_COMPANY',
			label: 'Company loan',
			amount: -30,
			destination: 'NET',
			source_id: 'company-repayment-child'
		},
		{
			family: 'CLAIM',
			component_code: 'EXPENSES',
			label: 'Expenses',
			amount: 40,
			destination: 'NET',
			source_id: 'claim-entry'
		}
	],
	statutory: [{ scheme_code: 'SSS', employee_amount: 100, employer_amount: 200 }],
	gross: 1140,
	total_deductions: 150,
	net: 1030
};
const report = (
	employees: readonly SalaryEmployee[] = [employee],
	jurisdiction = 'PH',
	catalogs: readonly SalaryCatalog[] = [],
	configuration: unknown = {
		...profile(jurisdiction),
		items: [
			...(profile(jurisdiction).items ?? []),
			// The shared synthetic employee retains these two known recipients in each report fixture.
			{ family: 'LOAN_REPAYMENT', code: 'LOAN_RECOVERY_SSS_SALARY', payment: 'EXTERNAL' },
			{ family: 'LOAN_REPAYMENT', code: 'LOAN_RECOVERY_COMPANY', payment: 'INTERNAL' }
		]
	}
) =>
	salaryReport({
		company: 'Test employer',
		period: '2026-03',
		currency: jurisdiction === 'MY' ? 'MYR' : 'PHP',
		run_kind: 'REGULAR',
		pay_date: '2026-03-31',
		run_reference: 'TEST-RUN-001',
		minor_units: 2,
		configuration,
		catalogs: [
			{ family: 'WORK', code: 'BASIC', direction: 'ADD' },
			{ family: 'WORK', code: 'OT', direction: 'ADD' },
			{ family: 'ALLOWANCE', code: 'MEAL', direction: 'ADD' },
			{ family: 'ADHOC', code: 'BONUS', direction: 'ADD' },
			...catalogs
		],
		employees
	});
const amount = (value: ReturnType<typeof report>, family: string, code: string, row = 0) =>
	value.rows[row]?.amounts[
		value.columns.findIndex((column) => column.family === family && column.code === code)
	];

it('salary listing preserves settled values and reversals, with raw-style groups and company cash destinations', () => {
	const listing = report([employee, { ...employee, employee_number: '0008', status: 'ON_HOLD' }]);
	assert.equal(listing.rows.length, 2);
	assert.equal(listing.rows[1]?.status, 'ON_HOLD');
	assert.equal(amount(listing, 'ADHOC', 'BONUS'), -10);
	assert.equal(amount(listing, 'LOAN_REPAYMENT', 'LOAN_RECOVERY_SSS_SALARY'), 20);
	assert.equal(amount(listing, 'LOAN_REPAYMENT', 'LOAN_RECOVERY_COMPANY'), 30);
	assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), 1350);
	assert.equal(listing.columns.at(-1)?.label, 'Total company payment');
	const groups = listing.columns.map((column) => column.group);
	assert.ok(groups.indexOf('Employee statutory') < groups.indexOf('Employer statutory'));
	assert.ok(groups.indexOf('Employer statutory') < groups.indexOf('Loans and other deductions'));
	assert.ok(groups.indexOf('Loans and other deductions') < groups.indexOf('Net pay'));
});

it('company bank charges add only to company payment, with zero and unknown kept distinct', () => {
	const listing = report([
		{ ...employee, bank_charges: 50 },
		{ ...employee, employee_number: '0008', bank_charges: 0 },
		{ ...employee, employee_number: '0009', bank_charges: null }
	]);
	assert.equal(amount(listing, 'COMPANY_BANK_CHARGES', 'BANK_CHARGES'), 50);
	assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), 1400);
	assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT', 1), 1350);
	assert.equal(amount(listing, 'COMPANY_BANK_CHARGES', 'BANK_CHARGES', 2), null);
	assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT', 2), null);
	assert.equal(amount(listing, 'TOTAL', 'GROSS'), employee.gross);
	assert.equal(amount(listing, 'TOTAL', 'NET'), employee.net);
	assert.equal(amount(listing, 'EMPLOYEE_STATUTORY', 'SSS'), 100);
	assert.equal(amount(listing, 'EMPLOYER_STATUTORY', 'SSS'), 200);
	assert.equal(listing.columns.at(-2)?.label, 'Company bank charges');
	assert.equal(listing.columns.at(-1)?.label, 'Total company payment');
	const sheet = salaryWorkbook([listing]).worksheets[0];
	assert.ok(sheet);
	assert.equal(sheet.getCell(8, listing.columns.length + 3).result, 1400);
	assert.equal(sheet.getCell(10, listing.columns.length + 3).value, 'Needs confirmation');
	assert.equal(sheet.getCell(11, listing.columns.length + 3).value, 'Needs confirmation');
	assert.throws(() => report([{ ...employee, bank_charges: -1 }]));
});

it('family identity keeps equal codes distinct and an unconfirmed recipient suppresses its company total', () => {
	const listing = report(
		[
			{
				...employee,
				base: [{ component_code: 'MEAL', amount: 10 }],
				adjustments: [
					{ family: 'ADHOC', component_code: 'MEAL', amount: 20, destination: 'PAY' },
					{
						family: 'LOAN_REPAYMENT',
						component_code: 'AIR_TICKET_DEDUCTION',
						amount: -50,
						destination: 'NET'
					}
				]
			}
		],
		'MY'
	);
	assert.equal(amount(listing, 'ALLOWANCE', 'MEAL'), 10);
	assert.equal(amount(listing, 'ADHOC', 'MEAL'), 20);
	assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), null);
	assert.match(listing.warnings[0] ?? '', /AIR_TICKET_DEDUCTION/);
	const book = salaryWorkbook([listing]);
	const sheet = book.worksheets[0];
	assert.ok(sheet);
	assert.equal(sheet.getCell(8, listing.columns.length + 3).value, 'Needs confirmation');
	assert.equal(sheet.getCell(9, listing.columns.length + 3).value, 'Needs confirmation');
});

it.effect(
	'salary XLSX has numeric amounts, cached formulas, grouped headers and separate run/currency sheets',
	Effect.fnUntraced(function* () {
		const listing = report();
		const book = salaryWorkbook([
			listing,
			{ ...listing, company: 'Other employer', currency: 'JPY', minor_units: 0 }
		]);
		const bytes = yield* Effect.tryPromise(() => book.xlsx.writeBuffer());
		const read = new ExcelJS.Workbook();
		yield* Effect.tryPromise(() => read.xlsx.load(bytes));
		assert.equal(read.worksheets.length, 2);
		const sheet = read.worksheets[0];
		assert.ok(sheet);
		assert.equal(sheet.getCell('A8').value, '0007');
		const bonus =
			listing.columns.findIndex((column) => column.family === 'ADHOC' && column.code === 'BONUS') +
			4;
		assert.equal(sheet.getCell(8, bonus).type, ExcelJS.ValueType.Number);
		assert.equal(sheet.getCell(8, bonus).value, -10);
		assert.equal(sheet.getCell(8, listing.columns.length + 3).result, 1350);
		assert.equal(sheet.getCell(9, listing.columns.length + 3).result, 1350);
		assert.match(sheet.getCell(8, listing.columns.length + 3).formula, /\+/);
		assert.equal(sheet.getCell('A6').isMerged, true);
		assert.equal(sheet.views[0]?.state, 'frozen');
	})
);

it('salary listing keeps statutory carry recoveries internal, under deductions', () => {
	const listing = report([
		{
			...employee,
			adjustments: [
				{
					family: 'STATUTORY_CARRY',
					component_code: 'CPF:2026-02',
					amount: -60,
					destination: 'NET'
				}
			],
			gross: 1150,
			total_deductions: 160,
			net: 990
		}
	]);
	const column = listing.columns.find((column) => column.family === 'STATUTORY_CARRY');
	assert.equal(column?.group, 'Loans and other deductions');
	assert.equal(column?.external, false);
	assert.equal(amount(listing, 'STATUTORY_CARRY', 'CPF:2026-02'), 60);
	assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), 1290);
});

it('salary listing groups daily and piece wages as basic pay, and work-family leave wages as leave pay', () => {
	const listing = report(
		[
			{
				...employee,
				base: [
					{ component_code: 'BASIC_DAILY', amount: 400 },
					{ component_code: 'PIECE_WORK', amount: 500 },
					{ component_code: 'PIECE_PAY', amount: 600 },
					{ component_code: 'PIECE_PAID_DAYS', amount: 100 },
					{ component_code: 'ANNUAL_LEAVE_PAY', amount: 200 },
					{ component_code: 'LEAVE_PAY', amount: 300 },
					{ component_code: 'ENCASHMENT', amount: 50 },
					{ component_code: 'OT', amount: 75 }
				]
			}
		],
		'TH',
		[],
		{
			items: [
				...['BASIC_DAILY', 'PIECE_WORK', 'PIECE_PAY'].map((code) => ({
					family: 'WORK',
					code,
					group: 'Basic pay'
				})),
				...['PIECE_PAID_DAYS', 'ANNUAL_LEAVE_PAY', 'LEAVE_PAY', 'ENCASHMENT'].map((code) => ({
					family: 'WORK',
					code,
					group: 'Leave pay'
				})),
				{ family: 'LOAN_REPAYMENT', code: 'LOAN_RECOVERY_SSS_SALARY', payment: 'EXTERNAL' },
				{ family: 'LOAN_REPAYMENT', code: 'LOAN_RECOVERY_COMPANY', payment: 'INTERNAL' }
			]
		}
	);
	const groups = new Map(listing.columns.map((column) => [column.code, column.group]));
	for (const code of ['BASIC_DAILY', 'PIECE_WORK', 'PIECE_PAY'])
		assert.equal(groups.get(code), 'Basic pay');
	for (const code of ['PIECE_PAID_DAYS', 'ANNUAL_LEAVE_PAY', 'LEAVE_PAY', 'ENCASHMENT'])
		assert.equal(groups.get(code), 'Leave pay');
	assert.equal(groups.get('OT'), 'Overtime and other work');
});

it('untracked company-paid entries suppress only the affected company payment and workbook total', () => {
	for (const [jurisdiction, family, code] of [
		['ID', 'ADHOC', 'KESEHATAN_TERMINATION_MONTH_EMPLOYER'],
		['ID', 'ADHOC', 'LATE_THR_FINE'],
		['MY', 'CLAIM', 'MEDICAL_CLAIM_DIRECT'],
		['PH', 'CLAIM', 'MEDICAL_CLAIM_DIRECT'],
		['VN', 'ADHOC', 'EMPLOYER_PENSION_CONTRIBUTION'],
		['VN', 'ADHOC', 'NON_ACCUMULATING_INSURANCE'],
		['VN', 'ADHOC', 'TRAINING_SUPPORT']
	]) {
		assert.ok(jurisdiction && family && code);
		const listing = report(
			[
				{ ...employee, consumed_entries: [{ family, code }] },
				{ ...employee, employee_number: '0008' }
			],
			jurisdiction,
			[{ family, code, destination: 'EMPLOYER', name: 'Company-paid item' }]
		);
		assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), null);
		assert.equal(typeof amount(listing, 'TOTAL', 'COMPANY_PAYMENT', 1), 'number');
		assert.equal(amount(listing, 'TOTAL', 'GROSS'), employee.gross);
		assert.equal(amount(listing, 'TOTAL', 'NET'), employee.net);
		assert.match(listing.warnings[0] ?? '', new RegExp(code));
		assert.equal(
			salaryWorkbook([listing]).worksheets[0]?.getCell(10, listing.columns.length + 3).value,
			'Needs confirmation'
		);
	}
});

it('captured company-paid claims include capped amounts and reversals once, without changing employee pay', () => {
	const family = 'CLAIM';
	const code = 'MEDICAL_CLAIM_DIRECT';
	const company_payments = [
		{ family, source_id: 'visit-1', component_code: code, amount: 70 },
		{ family, source_id: 'visit-2', component_code: code, amount: 30 },
		{ family, source_id: 'visit-reversal', component_code: code, amount: -10 }
	];
	const listing = report(
		[
			{
				...employee,
				company_payments,
				consumed_entries: company_payments.map((payment) => ({
					family,
					code,
					source_id: payment.source_id
				}))
			}
		],
		'MY',
		[{ family, code, destination: 'EMPLOYER' }]
	);
	assert.equal(amount(listing, family, code), 90);
	assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), 1440);
	assert.equal(amount(listing, 'TOTAL', 'GROSS'), employee.gross);
	assert.equal(amount(listing, 'TOTAL', 'NET'), employee.net);
	assert.equal(
		listing.columns.find((column) => column.family === family && column.code === code)?.group,
		'Company-paid claims and benefits'
	);
	assert.deepEqual(listing.warnings, []);
	const sheet = salaryWorkbook([listing]).worksheets[0];
	assert.equal(sheet?.getCell(8, listing.columns.length + 3).result, 1440);

	const partial = report(
		[
			{
				...employee,
				company_payments: company_payments.slice(0, 1),
				consumed_entries: company_payments.map((payment) => ({
					family,
					code,
					source_id: payment.source_id
				}))
			}
		],
		'MY',
		[{ family, code, destination: 'EMPLOYER' }]
	);
	assert.equal(amount(partial, 'TOTAL', 'COMPANY_PAYMENT'), null);
});

it('noncash benefits, reimbursements, unpaid sources and non-employer definitions do not suppress company payments', () => {
	for (const [jurisdiction, family, code, destination, consumed] of [
		['PH', 'ADHOC', 'FRINGE_BENEFIT', 'EMPLOYER', true],
		['SG', 'CLAIM', 'GPML_REIMBURSEMENT', 'EMPLOYER', true],
		['ID', 'ADHOC', 'KESEHATAN_TERMINATION_MONTH_EMPLOYER', 'PAY', true],
		['ID', 'ADHOC', 'KESEHATAN_TERMINATION_MONTH_EMPLOYER', 'EMPLOYER', false]
	] as const) {
		const listing = report(
			[{ ...employee, consumed_entries: consumed ? [{ family, code }] : [] }],
			jurisdiction,
			[{ family, code, destination }]
		);
		assert.equal(typeof amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), 'number');
		assert.deepEqual(listing.warnings, []);
	}
});

it('captured company-paid housing counts as cash while tax-only employer lines remain information', () => {
	const housing = { family: 'ALLOWANCE', code: 'HOUSING', destination: 'EMPLOYER' };
	const listing = report(
		[
			{ ...employee, base: [{ component_code: 'HOUSING', amount: 900 }] },
			{ ...employee, employee_number: '0008', base: [{ component_code: 'HOUSING', amount: 0 }] }
		],
		'VN',
		[housing]
	);
	assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), 2250);
	assert.equal(typeof amount(listing, 'TOTAL', 'COMPANY_PAYMENT', 1), 'number');
	assert.equal(
		listing.columns.find((column) => column.code === 'HOUSING')?.group,
		'Company-paid claims and benefits'
	);
	const taxOnly = report(
		[{ ...employee, base: [{ component_code: 'MEAL_TAXABLE_EXCESS', amount: 20 }] }],
		'TW',
		[{ family: 'WORK', code: 'MEAL_TAXABLE_EXCESS', destination: 'EMPLOYER' }]
	);
	assert.equal(typeof amount(taxOnly, 'TOTAL', 'COMPANY_PAYMENT'), 'number');
	assert.equal(
		taxOnly.columns.find((column) => column.code === 'MEAL_TAXABLE_EXCESS')?.group,
		'Tax and benefit information'
	);
	assert.deepEqual(taxOnly.warnings, []);
});

it('arbitrary catalogue codes follow configured grouping and internal or external cash destinations', () => {
	const listing = report(
		[
			{
				...employee,
				base: [{ component_code: 'CONTRACT_WAGE_X', amount: 1000 }],
				adjustments: [
					{
						family: 'ADHOC',
						component_code: 'OUTSIDE_RECIPIENT_X',
						amount: -20,
						destination: 'NET'
					},
					{
						family: 'LOAN_REPAYMENT',
						component_code: 'EMPLOYER_RECOVERY_X',
						amount: -10,
						destination: 'NET'
					}
				],
				statutory: [],
				gross: 1000,
				total_deductions: 30,
				net: 970
			}
		],
		'PH',
		[{ family: 'ADHOC', code: 'OUTSIDE_RECIPIENT_X', direction: 'SUBTRACT', destination: 'NET' }],
		{
			group_order: ['Total company payment', 'Other pay first', 'Contract pay next'],
			items: [
				{ family: 'WORK', code: 'CONTRACT_WAGE_X', group: 'Contract pay next' },
				{
					family: 'ADHOC',
					code: 'OUTSIDE_RECIPIENT_X',
					group: 'Other pay first',
					payment: 'EXTERNAL'
				},
				{ family: 'LOAN_REPAYMENT', code: 'EMPLOYER_RECOVERY_X', payment: 'INTERNAL' }
			]
		}
	);
	assert.equal(listing.columns[0]?.code, 'OUTSIDE_RECIPIENT_X');
	assert.equal(listing.columns[1]?.code, 'CONTRACT_WAGE_X');
	assert.equal(listing.columns.at(-1)?.code, 'COMPANY_PAYMENT');
	assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), 990);
	assert.deepEqual(listing.warnings, []);
});

it('missing payment profiles and unmapped recipients or employer costs keep company totals unconfirmed', () => {
	for (const [configuration, family, code, destination, amountValue] of [
		[null, 'ADHOC', 'UNKNOWN_DEDUCTION_X', 'NET', -20],
		[{}, 'ADHOC', 'UNKNOWN_DEDUCTION_X', 'NET', -20],
		[{}, 'LOAN_REPAYMENT', 'UNKNOWN_LOAN_X', 'NET', -20],
		[{}, 'CLAIM', 'UNKNOWN_EMPLOYER_COST_X', 'EMPLOYER', 20]
	] as const) {
		const listing = report(
			[
				{
					...employee,
					base: [],
					adjustments: [{ family, component_code: code, amount: amountValue, destination }],
					statutory: []
				}
			],
			'PH',
			[],
			configuration
		);
		assert.equal(amount(listing, 'TOTAL', 'COMPANY_PAYMENT'), null);
		assert.equal(amount(listing, 'TOTAL', 'GROSS'), employee.gross);
		assert.equal(amount(listing, 'TOTAL', 'NET'), employee.net);
		assert.ok(listing.warnings.length > 0);
	}
});
