// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The payroll workbook's salary listing: the entity and the month on top, the column bands, one
 * header per class these payslips settled in pay order, rows by section then group, a bold subtotal
 * under each section and a grand total. Every figure below is added by hand from the fixture.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import ExcelJS from 'exceljs';
import { payrollReportXlsx } from '../src/lib/payroll/run/export.ts';

const line = (componentCode, componentName, bucket, family, amount) => ({
	componentCode,
	componentName,
	bucket,
	family,
	calculationSource: 'DERIVED',
	amount,
	quantity: null,
	isCompanyDirect: false,
	isClaim: family === 'CLAIM',
	isLoanInstalment: family === 'LOAN_REPAYMENT'
});
const charge = (scheme_code, listing_order, base, employee, employer) => ({
	scheme_code,
	label: `${scheme_code} label`,
	listing_order,
	listing_group: null,
	base,
	employee,
	employer
});
const payslip = (employeeNumber, section, group, lines, contributions, totals) => ({
	employmentId: `internal-${employeeNumber}`,
	employeeNumber,
	currency: 'XXX',
	designation: 'Clerk',
	section,
	group,
	employeeName: `Person ${employeeNumber}`,
	identityNumber: null,
	hireDate: '2020-01-06',
	lastDay: null,
	unfundedContributions: 0,
	fundingReceived: 0,
	totalDeductions: 0,
	employerCost: 0,
	...totals,
	lines,
	contributions: new Map(contributions.map((row) => [row.scheme_code, row]))
});

// Gross = earnings − unpaid leave; net = gross + claim − loan − employee shares.
const A2 = payslip(
	'E002',
	'ADMIN',
	'B',
	[
		line('BASIC', 'Basic pay', 'EARNING', 'BASE', 3000),
		line('UNPAID', 'Unpaid leave', 'ABSENCE', 'LEAVE', 100),
		line('MEDICAL', 'Medical claim', 'NON_WAGE_PAYMENT', 'CLAIM', 50)
	],
	[charge('FUND', 1, 2900, 319, 377), charge('LEVY', 3, 2900, 0, 29)],
	{ gross: 2900, net: 2631 }
);
const A1 = payslip(
	'E001',
	'ADMIN',
	'A',
	[
		line('BASIC', 'Basic pay', 'EARNING', 'BASE', 2000),
		line('TRANSPORT', 'Transport allowance', 'EARNING', 'ALLOWANCE', 200),
		line('OVERTIME', 'Overtime', 'EARNING', 'WORK_DAY', 150.5),
		line('AL_ENCASH', 'Annual leave encashment', 'EARNING', 'LEAVE', 80)
	],
	[charge('FUND', 1, 2430.5, 267, 316), charge('CARE', 2, 2430.5, 10, 35)],
	{ gross: 2430.5, net: 2153.5 }
);
const L1 = payslip(
	'E003',
	'LAB',
	'A',
	[
		line('BASIC', 'Basic pay', 'EARNING', 'BASE', 1800),
		line('STAFF_LOAN', 'Staff loan', 'DEDUCTION', 'LOAN_REPAYMENT', 100)
	],
	[charge('FUND', 1, 1800, 198, 234)],
	{ gross: 1800, net: 1502 }
);

const HEADERS = [
	'Designation',
	'Section',
	'Group',
	'Employee no.',
	'Name',
	'Identity no.',
	'Hire date',
	'Last day',
	'Basic pay',
	'Transport allowance',
	'Overtime',
	'Annual leave encashment',
	'Unpaid leave',
	'Gross',
	'Medical claim',
	'Staff loan',
	'Net',
	'FUND label',
	'CARE label',
	'FUND label',
	'CARE label',
	'LEVY label',
	'FUND label base',
	'CARE label base',
	'LEVY label base',
	'Total expenses'
];

const listing = async () => {
	const bytes = await Effect.runPromise(
		payrollReportXlsx([
			{
				period: '2026-01',
				payDate: '2026-01-31',
				company: 'Fixture Sdn Bhd',
				payslips: [A2, L1, A1]
			}
		])
	);
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
	return workbook;
};
const values = (sheet, row) =>
	HEADERS.map((_, index) => {
		const value = sheet.getRow(row).getCell(index + 1).value;
		// exceljs writes no cached result for a formula that sums to zero.
		return value != null && typeof value === 'object' && 'formula' in value
			? (value.result ?? 0)
			: value;
	});

test('the salary listing is the first sheet, beside Summary, the matrix, Lines and Statutory', async () => {
	const workbook = await listing();
	assert.deepEqual(
		workbook.worksheets.map((sheet) => sheet.name),
		['2026-01 Salary listing', 'Summary', '2026-01', 'Lines', 'Statutory']
	);
	const sheet = workbook.worksheets[0];
	assert.equal(sheet.getCell('A1').value, 'Fixture Sdn Bhd');
	assert.equal(sheet.getCell('A2').value, 'STAFF SALARY LISTING - JAN 2026');
	assert.deepEqual(sheet.views[0], {
		...sheet.views[0],
		state: 'frozen',
		xSplit: 5,
		ySplit: 4
	});
	assert.deepEqual(values(sheet, 4), HEADERS);
	const band = (column) => sheet.getRow(3).getCell(column).value;
	assert.deepEqual(
		[band(1), band(9), band(14), band(15), band(17), band(18), band(20), band(23), band(26)],
		[
			'Employee',
			'Earnings',
			'Gross',
			'Additions & deductions',
			'Net',
			'Employee statutory',
			'Employer statutory',
			'Reference bases',
			'Total'
		]
	);
	assert.equal(sheet.getCell('I5').numFmt, '#,##0.00;-#,##0.00');
});

test('rows run by section then group, a bold subtotal per section and a grand total', async () => {
	const sheet = (await listing()).worksheets[0];
	const hired = new Date('2020-01-06T00:00:00Z');
	assert.deepEqual(values(sheet, 5), [
		'Clerk',
		'ADMIN',
		'A',
		'E001',
		'Person E001',
		null,
		hired,
		null,
		2000,
		200,
		150.5,
		80,
		0,
		2430.5,
		0,
		0,
		2153.5,
		267,
		10,
		316,
		35,
		0,
		2430.5,
		2430.5,
		0,
		2430.5 + 316 + 35
	]);
	assert.deepEqual(values(sheet, 6), [
		'Clerk',
		'ADMIN',
		'B',
		'E002',
		'Person E002',
		null,
		hired,
		null,
		3000,
		0,
		0,
		0,
		-100,
		2900,
		50,
		0,
		2631,
		319,
		0,
		377,
		0,
		29,
		2900,
		0,
		2900,
		2900 + 377 + 29
	]);
	assert.deepEqual(values(sheet, 7), [
		null,
		'ADMIN',
		null,
		null,
		'Subtotal: ADMIN (2)',
		null,
		null,
		null,
		5000,
		200,
		150.5,
		80,
		-100,
		5330.5,
		50,
		0,
		4784.5,
		586,
		10,
		693,
		35,
		29,
		5330.5,
		2430.5,
		2900,
		6087.5
	]);
	assert.equal(sheet.getCell('I7').value.formula, 'SUBTOTAL(9,I5:I6)');
	assert.equal(sheet.getCell('I7').font.bold, true);
	assert.deepEqual(values(sheet, 8).slice(0, 5), ['Clerk', 'LAB', 'A', 'E003', 'Person E003']);
	assert.deepEqual(
		values(sheet, 9).slice(8),
		[1800, 0, 0, 0, 0, 1800, 0, -100, 1502, 198, 0, 234, 0, 0, 1800, 0, 0, 2034]
	);
	assert.deepEqual(values(sheet, 10), [
		null,
		null,
		null,
		null,
		'TOTAL (3)',
		null,
		null,
		null,
		6800,
		200,
		150.5,
		80,
		-100,
		7130.5,
		50,
		-100,
		6286.5,
		784,
		10,
		927,
		35,
		29,
		7130.5,
		2430.5,
		2900,
		8121.5
	]);
	assert.equal(sheet.getCell('I10').value.formula, 'SUBTOTAL(9,I5:I9)');
	assert.equal(sheet.getCell('E10').font.bold, true);
	assert.equal(sheet.rowCount, 10);
	// No internal id anywhere on the sheet.
	sheet.eachRow((row) =>
		row.eachCell((cell) => assert.ok(!String(cell.value).includes('internal-')))
	);
});
