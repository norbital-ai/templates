/**
 * The payroll workbook, as an operator opens it.
 *
 * This used to run off `pnpm build`, against the emitted `.norbital/dist/**` chunk — a custom build
 * script, which `generated-and-build.md` forbids inside a tenant workspace, and which additionally
 * asserted a bundler property (that the export lands in its own lazy chunk) rather than a payroll
 * fact. What is worth asserting is the behaviour, so it is asserted here, against the source module,
 * from `pnpm test`.
 *
 * It loads through Vite rather than Node's type-stripping runner because `export.ts` imports the
 * bare browser build of ExcelJS, which only resolves under Vite — the same reason
 * `verify-overtime-controls.mjs` is shaped this way.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS EXERCISED, AND WHY IT IS NOT AN EMPTY PAYROLL.
 *
 * This gate previously exported `[{ period, payslips: [] }]` and asserted two things: that the bytes
 * begin with the zip magic, and that a worksheet by that name exists. An empty payroll writes no
 * masthead band it can get wrong, no header row, no data row and no TOTAL — so the vendor layout,
 * which is the entire reason this export exists, went unexercised. Everything below therefore runs
 * a populated payroll: two Malaysian payslips, which is what selects the vendor layout, and one
 * Singaporean one, which is what selects the generic layout beside it.
 *
 * The Malaysian figures are not invented. `NHPMY0023` is the employee the arithmetic gate verifies
 * end to end — basic 3,451, unpaid leave 55.66, overtime 365.44, gross 3,760.78, and the EPF /
 * SOCSO / EIS charges that `verify-payroll-arithmetic.mjs` derives from the seeded statutory
 * tables. `NHPMY0400`'s 690 basic is the source workbook's own late-joiner figure, 2,300 × 9/30.
 * Using those numbers means a cell that moves here is a cell that disagrees with a payslip.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import ExcelJS from 'exceljs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({
	root,
	appType: 'custom',
	logLevel: 'silent',
	server: { middlewareMode: true }
});

/** A payslip line, with every flag `report.ts` reads spelled out so no default is load-bearing. */
const line = (overrides) => ({
	payComponentCode: 'UNUSED',
	payComponentName: 'Unused',
	nature: 'EARNING',
	calculationSource: 'ENTRY',
	amount: 0,
	quantity: null,
	isCompanyDirect: false,
	isClaim: false,
	isLoanInstalment: false,
	overtimeDayType: null,
	isOvertimeExcess: false,
	...overrides
});

/** The employee `verify-payroll-arithmetic.mjs` verifies: basic 3,451, NPL 55.66, overtime 365.44. */
const VERIFIED = {
	employmentId: 'emp-0023',
	employeeNumber: 'NHPMY0023',
	currency: 'MYR',
	designation: 'Machine Operator',
	section: 'Assembly',
	group: 'MY-MONTHLY',
	employeeName: 'Aisyah binti Rahman',
	identityNumber: '920104-10-5522',
	hireDate: '2021-06-01',
	lastDay: null,
	attendance: { normalHours: 208, actualHours: 230, shiftCodes: ['D'] },
	gross: 3760.78,
	totalDeductions: 400.25,
	net: 3454.03,
	employerCost: 515.15,
	lines: [
		line({
			payComponentCode: 'BASIC',
			payComponentName: 'Basic salary',
			calculationSource: 'SCHEDULE',
			amount: 3451
		}),
		line({
			payComponentCode: 'UNPAID_LEAVE_DEDUCTION',
			payComponentName: 'Unpaid leave',
			nature: 'ABSENCE',
			calculationSource: 'FORMULA',
			amount: 55.66,
			quantity: 0.5
		}),
		line({
			payComponentCode: 'OT_ORDINARY',
			payComponentName: 'Overtime',
			calculationSource: 'OVERTIME',
			amount: 365.44,
			quantity: 22,
			overtimeDayType: 'ORDINARY'
		}),
		line({
			payComponentCode: 'MEDICAL_CLAIM',
			payComponentName: 'Medical claim',
			nature: 'NON_WAGE_PAYMENT',
			amount: 93.5,
			isClaim: true
		})
	],
	contributions: new Map([
		['EPF', { base: 3395.34, employee: 374, employer: 442 }],
		['SOCSO', { base: 3760.78, employee: 18.75, employer: 65.65 }],
		['EIS', { base: 3760.78, employee: 7.5, employer: 7.5 }],
		['PCB', { base: 3760.78, employee: 0, employer: 0 }]
	])
};

/** A late joiner, so the sheet also carries rest-day work, incentive overtime and a loan recovery. */
const JOINER = {
	employmentId: 'emp-0400',
	employeeNumber: 'NHPMY0400',
	currency: 'MYR',
	designation: 'Packer',
	section: 'Warehouse',
	group: 'MY-MONTHLY',
	employeeName: 'Tan Wei Ming',
	identityNumber: '001122-14-3311',
	hireDate: '2026-04-22',
	lastDay: null,
	attendance: { normalHours: 72, actualHours: 81, shiftCodes: ['D', 'N'] },
	gross: 1005.91,
	totalDeductions: 183.05,
	net: 822.86,
	employerCost: 109.65,
	lines: [
		line({
			payComponentCode: 'BASIC',
			payComponentName: 'Basic salary',
			calculationSource: 'SCHEDULE',
			amount: 690
		}),
		line({
			payComponentCode: 'TRANSPORT',
			payComponentName: 'Transport allowance',
			amount: 150
		}),
		line({
			payComponentCode: 'OT_REST_DAY',
			payComponentName: 'Rest day work',
			calculationSource: 'OVERTIME',
			amount: 132.73,
			quantity: 8,
			overtimeDayType: 'REST_DAY'
		}),
		line({
			payComponentCode: 'OT_INCENTIVE',
			payComponentName: 'Incentive overtime',
			calculationSource: 'OVERTIME_EXCESS',
			amount: 33.18,
			quantity: 1,
			overtimeDayType: 'REST_DAY',
			isOvertimeExcess: true
		}),
		line({
			payComponentCode: 'STAFF_LOAN',
			payComponentName: 'Staff loan instalment',
			nature: 'DEDUCTION',
			amount: 100,
			isLoanInstalment: true
		})
	],
	contributions: new Map([
		['EPF', { base: 690, employee: 76, employer: 90 }],
		['SOCSO', { base: 1005.91, employee: 5.05, employer: 17.65 }],
		['EIS', { base: 1005.91, employee: 2, employer: 2 }],
		['PCB', { base: 1005.91, employee: 0, employer: 0 }]
	])
};

/** Not MYR, so this sheet takes the generic layout and grows its columns from what CPF charged. */
const SINGAPORE = {
	employmentId: 'emp-sg-1',
	employeeNumber: 'NHPSG0001',
	currency: 'SGD',
	designation: 'Engineer',
	section: 'Operations',
	group: 'SG-MONTHLY',
	employeeName: 'Lim Jia Hui',
	identityNumber: 'S9012345A',
	hireDate: '2022-02-01',
	lastDay: null,
	attendance: { normalHours: 176, actualHours: 186, shiftCodes: ['G'] },
	gross: 5300,
	totalDeductions: 1060,
	net: 4240,
	employerCost: 914.25,
	lines: [
		line({
			payComponentCode: 'BASIC',
			payComponentName: 'Basic salary',
			calculationSource: 'SCHEDULE',
			amount: 5000
		}),
		line({
			payComponentCode: 'OT_ORDINARY',
			payComponentName: 'Overtime',
			calculationSource: 'OVERTIME',
			amount: 300,
			quantity: 10,
			overtimeDayType: 'ORDINARY'
		})
	],
	contributions: new Map([
		['CPF', { base: 5300, employee: 1060, employer: 901 }],
		['SDL', { base: 5300, employee: 0, employer: 13.25 }]
	])
};

/**
 * Row 5 of the vendor sheet, verbatim.
 *
 * Written out rather than derived, because deriving it from `VENDOR_WORKBOOK_COLUMNS` with the same
 * transformation the exporter uses would agree with the exporter no matter what the exporter did.
 * A column renamed, reordered, added or dropped has to fail here.
 */
const VENDOR_HEADERS = [
	'Designation',
	'Section',
	'Group',
	'Employee ID',
	'Name',
	'Identification No.',
	'Hire Date',
	'Last Day',
	'Basic Salary',
	'Allowance',
	'Overtime',
	'AWS',
	'Back Pay Bonus',
	'Back Pay OT',
	'Back Pay Basic NPL',
	'Leave Encashment',
	'No Pay Leave',
	'No Pay Leave Adj',
	'Annual Leave Deduction',
	'Short Notice',
	'Gross Salary',
	'OT Incentive',
	'Incentive AWS',
	'Medical Claim',
	'Renewal Incentive',
	'Ex Gratia Loss',
	'Attendance Allowance',
	'Loan Recovery',
	'PCB Back Pay',
	'Medical Recover EE',
	'CP38 Amount',
	'Net Salary',
	'FW Levy',
	'Check Vendor Workbook',
	'EPF (Employee)',
	'SOCSO (Employee)',
	'EIS (Employee)',
	'PCB / Tax',
	'EPF (Employer)',
	'SOCSO (Employer)',
	'EIS (Employer)',
	'HRDF',
	'Remark',
	'Total SOCSO',
	'Total EIS',
	'Total EPF',
	'Remuneration For Tax',
	'EPF Gross',
	'SOCSO Gross',
	'Total Expenses',
	'ATT OT 1X Hours',
	'ATT OT 1.5X Hours',
	'ATT OT 2X Hours',
	'ATT OT 3X Hours',
	'ATT OT Flat Hours',
	'Normal Hours',
	'Actual Hours',
	'Shift Codes'
];

/** A worksheet's cell values across one row, one-based and dense. */
function rowValues(sheet, rowNumber) {
	const row = sheet.getRow(rowNumber);
	return Array.from({ length: sheet.columnCount }, (_, index) => row.getCell(index + 1).value);
}

/** The `A1`-style address a merged cell reports as its owner, or null when it stands alone. */
function mergeMaster(sheet, rowNumber, column) {
	const cell = sheet.getRow(rowNumber).getCell(column);
	return cell.isMerged ? cell.master.address : null;
}

/**
 * Evaluate a `SUM(<letter><from>:<letter><to>)` cell against the sheet it sits on.
 *
 * ExcelJS stores a formula, not a value, so nothing in the file itself says the TOTAL row is the
 * sum of the rows above it. Reading the range the formula names and adding those cells up is what
 * turns "a formula is present" into "the total is the total": a range that starts a row early picks
 * up the string header and produces `NaN`, and one that stops a row short produces a smaller number.
 */
function evaluateSum(sheet, rowNumber, column) {
	const value = sheet.getRow(rowNumber).getCell(column).value;
	assert.equal(typeof value?.formula, 'string', `R${rowNumber}C${column} carries no formula`);
	const match = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(value.formula);
	assert.ok(match, `unexpected total formula ${JSON.stringify(value.formula)}`);
	const [, fromLetter, fromRow, toLetter, toRow] = match;
	assert.equal(fromLetter, toLetter, 'a column total must not span columns');
	assert.equal(fromLetter, sheet.getColumn(column).letter, 'the total sums its own column');
	let total = 0;
	for (let index = Number(fromRow); index <= Number(toRow); index += 1)
		total += Number(sheet.getRow(index).getCell(column).value);
	return Math.round(total * 100) / 100;
}

try {
	const { payrollReportXlsx } = await vite.ssrLoadModule(
		'/src/collections/payroll_runs/lib/export.ts'
	);
	const { VENDOR_WORKBOOK_COLUMNS, VENDOR_WORKBOOK_SECTIONS } = await vite.ssrLoadModule(
		'/src/collections/payroll_runs/lib/report.ts'
	);

	const bytes = await payrollReportXlsx([
		{ period: '2026-03', payDate: '2026-03-28', payslips: [VERIFIED, JOINER] },
		{ period: '2026-04', payDate: '2026-04-28', payslips: [SINGAPORE] }
	]);
	const archive = Uint8Array.from(bytes);

	// "PK\x03\x04": an XLSX is a zip, and a workbook that failed to serialise is not one.
	assert.deepEqual([...archive.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(archive);

	// ── the vendor sheet: named for the period an operator asked for ──────────────────────────────
	const listing = workbook.getWorksheet('2026-03 Salary Listing');
	assert.ok(listing, 'the MYR period has no "<period> Salary Listing" sheet');
	assert.ok(listing.name.length <= 31, 'Excel refuses a worksheet name past 31 characters');
	assert.equal(listing.state, 'visible');
	assert.equal(listing.columnCount, VENDOR_WORKBOOK_COLUMNS.length);
	assert.equal(VENDOR_WORKBOOK_COLUMNS.length, 58, 'the vendor column vocabulary changed');

	// ── the masthead: a title and the month, each merged across the whole sheet ───────────────────
	assert.equal(listing.getCell(1, 1).value, 'SALARY LISTING');
	assert.equal(mergeMaster(listing, 1, VENDOR_WORKBOOK_COLUMNS.length), 'A1');
	assert.equal(
		listing.getCell(2, 1).value,
		'Salary month: 2026-03   ·   Pay date: 2026-03-28',
		'row 2 must name the period and the pay date the run settled on'
	);
	assert.equal(mergeMaster(listing, 2, VENDOR_WORKBOOK_COLUMNS.length), 'A2');

	// ── row 4: the section band, each name over exactly the columns of its own section ────────────
	let column = 1;
	const bandedSections = [];
	for (const section of VENDOR_WORKBOOK_SECTIONS) {
		const from = column;
		const to = from + section.outputIds.length - 1;
		bandedSections.push([section.name, from, to]);
		assert.equal(
			listing.getCell(4, from).value,
			section.name,
			`section ${section.name} does not start at column ${from}`
		);
		const owner = `${listing.getColumn(from).letter}4`;
		for (let position = from; position <= to; position += 1)
			assert.equal(
				mergeMaster(listing, 4, position),
				from === to ? null : owner,
				`column ${position} is not banded under ${section.name}`
			);
		if (to + 1 <= VENDOR_WORKBOOK_COLUMNS.length)
			assert.notEqual(
				mergeMaster(listing, 4, to + 1),
				owner,
				`${section.name} bleeds past column ${to}`
			);
		column = to + 1;
	}
	assert.equal(column - 1, VENDOR_WORKBOOK_COLUMNS.length, 'the band does not cover every column');
	assert.deepEqual(bandedSections, [
		['Identity', 1, 8],
		['Earnings & absence', 9, 20],
		['Gross', 21, 21],
		['Post-gross payments & deductions', 22, 31],
		['Net', 32, 32],
		['Statutory', 33, 43],
		['Totals & bases', 44, 50],
		['Attendance', 51, 58]
	]);

	// ── row 5: the column headers, in the vendor vocabulary's own order ───────────────────────────
	assert.deepEqual(rowValues(listing, 5), VENDOR_HEADERS);

	// ── row 6: what NHPMY0023 was actually paid, cell by cell ─────────────────────────────────────
	const at = (rowNumber, outputId) =>
		listing.getRow(rowNumber).getCell(VENDOR_WORKBOOK_COLUMNS.indexOf(outputId) + 1).value;
	assert.equal(at(6, 'eid'), 'NHPMY0023');
	assert.equal(at(6, 'name'), 'Aisyah binti Rahman');
	assert.equal(at(6, 'ic_no'), '920104-10-5522');
	assert.equal(at(6, 'designation'), 'Machine Operator');
	assert.equal(at(6, 'basic_salary'), 3451);
	// The overtime column carries priced overtime only; the claim is not an allowance and the
	// unpaid-leave deduction is not netted into either.
	assert.equal(at(6, 'allowance'), 0);
	assert.equal(at(6, 'overtime'), 365.44);
	assert.equal(at(6, 'no_pay_leave'), 55.66);
	assert.equal(at(6, 'gross_salary'), 3760.78);
	assert.equal(at(6, 'medical_claim'), 93.5);
	assert.equal(at(6, 'net_salary'), 3454.03);
	assert.equal(at(6, 'epf_employee'), 374);
	assert.equal(at(6, 'epf_employer'), 442);
	assert.equal(at(6, 'socso_employee'), 18.75);
	assert.equal(at(6, 'socso_employer'), 65.65);
	assert.equal(at(6, 'eis_employee'), 7.5);
	assert.equal(at(6, 'total_epf'), 816);
	assert.equal(at(6, 'total_socso'), 84.4);
	assert.equal(at(6, 'total_eis'), 15);
	assert.equal(at(6, 'epf_gross'), 3395.34);
	assert.equal(at(6, 'socso_gross'), 3760.78);
	// The vendor workbook prints post-EPF remuneration here, not the PCB scheme's gross input.
	assert.equal(at(6, 'remuneration_for_tax'), 3386.78);
	assert.equal(at(6, 'total_expenses'), 4369.43, 'gross + incentive OT + medical claim + employer');
	// Ordinary overtime is a 1.5× bucket; nothing lands in the rest-day or holiday ones.
	assert.equal(at(6, 'att_ot_15x_hours'), 22);
	assert.equal(at(6, 'att_ot_1x_hours'), 0);
	assert.equal(at(6, 'att_ot_2x_hours'), 0);
	assert.equal(at(6, 'att_normal_hours'), 208);
	assert.equal(at(6, 'att_actual_hours'), 230);
	assert.equal(at(6, 'att_shift_codes'), 'D');

	// ── row 7: the joiner, whose money reaches different columns from the same shapes ─────────────
	assert.equal(at(7, 'eid'), 'NHPMY0400');
	assert.equal(at(7, 'basic_salary'), 690, '2,300 × 9/30, the source workbook’s own figure');
	assert.equal(at(7, 'allowance'), 150, 'a standing allowance is not overtime and not basic');
	assert.equal(at(7, 'overtime'), 132.73, 'a rest day pays a day’s wages, not eight hourly units');
	assert.equal(at(7, 'incentive_ot'), 33.18, 'reclassified overtime leaves the overtime column');
	assert.equal(at(7, 'loan_recovery'), 100);
	assert.equal(at(7, 'gross_salary'), 1005.91);
	assert.equal(at(7, 'net_salary'), 822.86);
	assert.equal(at(7, 'att_ot_2x_hours'), 8, 'rest-day hours are the 2.0× bucket');
	assert.equal(at(7, 'att_ot_15x_hours'), 0);
	assert.equal(at(7, 'att_ot_1x_hours'), 1, 'excess hours are valued plain, so they read 1.0×');
	assert.equal(at(7, 'att_shift_codes'), 'D, N');

	// ── row 8: TOTAL, and it really is the total ──────────────────────────────────────────────────
	const totalRow = 8;
	assert.equal(at(totalRow, 'eid'), 'TOTAL');
	const totalOf = (outputId) =>
		evaluateSum(listing, totalRow, VENDOR_WORKBOOK_COLUMNS.indexOf(outputId) + 1);
	assert.equal(totalOf('basic_salary'), 4141);
	assert.equal(totalOf('overtime'), 498.17);
	assert.equal(totalOf('gross_salary'), 4766.69);
	assert.equal(totalOf('net_salary'), 4276.89);
	assert.equal(totalOf('epf_employee'), 450);
	assert.equal(totalOf('epf_employer'), 532);
	assert.equal(totalOf('total_expenses'), 5518.17);
	assert.equal(totalOf('att_ot_2x_hours'), 8);
	// Every money and hours column is totalled; the two text columns are deliberately not.
	for (const [index, outputId] of VENDOR_WORKBOOK_COLUMNS.entries()) {
		const value = listing.getRow(totalRow).getCell(index + 1).value;
		if (index < 8 || outputId === 'remark' || outputId === 'att_shift_codes') {
			assert.equal(
				typeof value?.formula,
				'undefined',
				`${outputId} must not carry a SUM — it is not a number`
			);
			continue;
		}
		assert.equal(typeof value?.formula, 'string', `${outputId} has no TOTAL`);
	}
	assert.equal(listing.rowCount, totalRow, 'nothing is written below the TOTAL row');

	// ── the generic sheet is kept, and kept out of the way ────────────────────────────────────────
	const hidden = workbook.getWorksheet('2026-03');
	assert.ok(hidden, 'the machine-readable sheet must survive the vendor layout');
	assert.equal(hidden.state, 'veryHidden');
	assert.equal(hidden.getRow(1).getCell(1).value, 'designation', 'row 1 stays the output ids');

	// ── a non-MYR period keeps the generic layout, and its statutory columns are what CPF charged ─
	const generic = workbook.getWorksheet('2026-04');
	assert.ok(generic, 'the SGD period has no sheet');
	assert.equal(generic.state, 'visible');
	assert.equal(
		workbook.getWorksheet('2026-04 Salary Listing'),
		undefined,
		'a non-MYR population must not be dressed in the Malaysian vendor layout'
	);
	assert.deepEqual(rowValues(generic, 1), [
		'Employee number',
		'Employment ID',
		'Currency',
		'proratedSalary',
		'taxableBenefits',
		'exemptBenefits',
		'overtimePay',
		'totalUnpaidLeaveDeduction',
		'grossEarnings',
		'incentiveOTPay',
		'totalClaims',
		'loanRecovery',
		'adhocDeductions',
		'netPay',
		'cpfEmployee',
		'cpfEmployer',
		'sdl',
		'totalCpf',
		'totalDeductions',
		'employerCost',
		'ot10Hours',
		'ot15Hours',
		'ot20Hours',
		'ot30Hours',
		'totalOTHours'
	]);
	// The band sits below the headers here, and column A stays blank so a row walker can tell a band
	// from a payslip by the absence of an employee number.
	assert.equal(generic.getRow(2).getCell(1).value, null);
	assert.equal(generic.getRow(2).getCell(2).value, 'Identity');
	assert.equal(mergeMaster(generic, 2, 3), 'B2');
	assert.equal(generic.getRow(2).getCell(4).value, 'Earnings & absence');
	assert.equal(generic.getRow(2).getCell(9).value, 'Gross');
	assert.equal(generic.getRow(2).getCell(15).value, 'Statutory');
	assert.deepEqual(rowValues(generic, 3), [
		'NHPSG0001',
		'emp-sg-1',
		'SGD',
		5000,
		0,
		0,
		300,
		0,
		5300,
		0,
		0,
		0,
		0,
		4240,
		1060,
		901,
		13.25,
		1961,
		1060,
		914.25,
		0,
		10,
		0,
		0,
		10
	]);

	// ── and an empty period still writes a real archive, as it always did ─────────────────────────
	const emptyBytes = await payrollReportXlsx([{ period: 'verification', payslips: [] }]);
	const empty = new ExcelJS.Workbook();
	await empty.xlsx.load(Uint8Array.from(emptyBytes));
	assert.equal(empty.getWorksheet('verification')?.name, 'verification');

	console.log(`Payroll XLSX verified (${archive.byteLength} bytes, ${listing.rowCount} rows).`);
} finally {
	await vite.close();
}
