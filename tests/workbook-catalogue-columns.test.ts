// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The workbook's columns are the catalogue's, one per component.
 *
 * They used to be a fixed vocabulary of derived sums. `taxableBenefits` was every earning that was
 * not salary or overtime; `adhocDeductions` was every deduction that was not a loan; the vendor
 * listing's `allowance` was every allowance code the projection did not recognise by name. An
 * employer with fourteen allowances exported one column for all fourteen and could not reconcile a
 * single line of it — which is exactly the complaint this test exists to keep answered.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { outputGroups, workbookRows } from '../src/collections/payroll_runs/lib/report.ts';

const line = (overrides) => ({
	componentCode: 'UNUSED',
	componentName: 'Unused',
	bucket: 'EARNING',
	calculationSource: 'ENTRY',
	amount: 0,
	quantity: null,
	isCompanyDirect: false,
	isClaim: false,
	isLoanInstalment: false,
	family:
		overrides.calculationSource === 'SCHEDULE'
			? 'BASE'
			: overrides.calculationSource === 'OVERTIME'
				? 'WORK_DAY'
				: overrides.bucket === 'ABSENCE'
					? 'WORK_DAY'
					: overrides.bucket === 'DEDUCTION'
						? 'PAYMENT'
						: 'ALLOWANCE',
	...overrides
});

const payslip = (employeeNumber, lines) => ({
	employmentId: `emp-${employeeNumber}`,
	employeeNumber,
	currency: 'MYR',
	designation: null,
	section: null,
	group: null,
	employeeName: employeeNumber,
	identityNumber: null,
	hireDate: '2024-01-01',
	lastDay: null,
	attendance: { normalHours: 176, actualHours: 176, shiftCodes: ['G'] },
	gross: lines.reduce((total, row) => total + (row.bucket === 'EARNING' ? row.amount : 0), 0),
	totalDeductions: 0,
	net: 0,
	employerCost: 0,
	lines,
	contributions: new Map()
});

const PAYSLIPS = [
	payslip('E1', [
		line({ componentCode: 'BASIC', calculationSource: 'SCHEDULE', amount: 3000 }),
		line({ componentCode: 'OVERTIME', calculationSource: 'OVERTIME', amount: 120 }),
		line({ componentCode: 'TRANSPORT', amount: 200 }),
		line({ componentCode: 'MEAL', amount: 90 }),
		line({ componentCode: 'PHONE', amount: 40 }),
		line({ componentCode: 'ABSENCE', bucket: 'ABSENCE', amount: 75 }),
		line({ componentCode: 'STAFF_LOAN', bucket: 'DEDUCTION', amount: 150 }),
		line({ componentCode: 'PARKING_FINE', bucket: 'DEDUCTION', amount: 30 })
	]),
	payslip('E2', [
		line({ componentCode: 'BASIC', calculationSource: 'SCHEDULE', amount: 2500 }),
		line({ componentCode: 'MEDICAL', bucket: 'NON_WAGE_PAYMENT', amount: 60 })
	])
];

const groups = () => outputGroups(PAYSLIPS, workbookRows(PAYSLIPS));
const section = (name) => groups().find((group) => group.name === name);

test('three allowances are three columns, not one lump', () => {
	const earnings = section('Allowances');
	for (const code of ['TRANSPORT', 'MEAL', 'PHONE'])
		assert.ok(earnings.outputIds.includes(code), `${code} has no column of its own`);
	for (const lump of ['taxableBenefits', 'adhocDeductions', 'totalClaims', 'proratedSalary'])
		assert.ok(
			groups().every((group) => !group.outputIds.includes(lump)),
			`the workbook still carries the ${lump} lump`
		);
});

test('sections read in the clerk’s order: basic, allowances, overtime, absence, gross, statutory, deductions, payments, net', () => {
	assert.deepEqual(
		groups().map((group) => group.name),
		[
			'Basic',
			'Allowances',
			'Overtime',
			'Absence',
			'Gross',
			'Deductions',
			'Payments',
			'Net',
			'Totals & bases'
		]
	);
	assert.deepEqual(section('Basic').outputIds, ['BASIC']);
	// Within a section, code order: the inferred catalogue order.
	assert.deepEqual(section('Allowances').outputIds, ['MEAL', 'PHONE', 'TRANSPORT']);
	assert.deepEqual(section('Overtime').outputIds, ['OVERTIME']);
});

test('a component is filed under the bucket it settled as', () => {
	assert.deepEqual(section('Absence').outputIds, ['ABSENCE']);
	assert.deepEqual(section('Deductions').outputIds, ['PARKING_FINE', 'STAFF_LOAN']);
	assert.deepEqual(section('Payments').outputIds, ['MEDICAL']);
	assert.deepEqual(section('Gross').outputIds, ['grossEarnings']);
	assert.deepEqual(section('Net').outputIds, ['netPay']);
});

test('a sheet is squared off: a component one person did not settle is an explicit zero', () => {
	const [first, second] = workbookRows(PAYSLIPS);
	assert.equal(first.TRANSPORT, 200);
	assert.equal(second.TRANSPORT, 0, 'not undefined — the component was assessed and paid nothing');
	assert.equal(second.MEDICAL, 60);
	assert.equal(first.MEDICAL, 0);
});

test('two lines under one code are one column and one sum', () => {
	const twice = [
		payslip('E3', [
			line({ componentCode: 'OVERTIME', calculationSource: 'OVERTIME', amount: 40 }),
			line({ componentCode: 'OVERTIME', calculationSource: 'OVERTIME', amount: 60 })
		])
	];
	assert.equal(workbookRows(twice)[0].OVERTIME, 100);
	assert.deepEqual(
		outputGroups(twice, workbookRows(twice)).find((group) => group.name === 'Overtime').outputIds,
		['OVERTIME']
	);
});
