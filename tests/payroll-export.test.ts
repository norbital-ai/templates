// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The payslip PDF carries the itemised pay slip particulars (EA 1968 s.96; S 148/2016 reg.9, Third
 * Schedule, read on SSO 2026-09-30): employer name (item 1), employee name (3), salary period first
 * and last days (5), overtime period where different (7), overtime hours (8), overtime pay and date
 * (9), deductions itemised (10) and net with its date (11). Deductions print signed.
 *
 * Hand-computed golden, SGD 3,000/month, one absent day of 22, four OT hours at 1.5x:
 * absence 3000 / 22 = 136.3636 -> 136.36; hourly basic (12 x 3000) / (52 x 44) = 15.7343,
 * x 1.5 x 4 = 94.4056 -> 94.41; gross 3000 - 136.36 + 94.41 = 2958.05; an illustrative scheme share of 591.61 (not a CPF figure:
 * the scheme's own rounding is not under test here);
 * net 2958.05 - 591.61 = 2366.44.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { payslipPdf } from '../src/lib/payroll/run/export.ts';

const line = (componentCode, bucket, family, amount, quantity = null, label = componentCode) => ({
	componentCode,
	componentName: componentCode,
	label,
	bucket,
	family,
	calculationSource: 'DERIVED',
	amount,
	quantity,
	isCompanyDirect: false,
	isClaim: false,
	isLoanInstalment: false
});

const payslip = {
	employmentId: 'e1',
	employeeNumber: 'N0001',
	employeeName: 'Tan Ah Kow',
	currency: 'SGD',
	gross: 2958.05,
	totalDeductions: 591.61,
	net: 2366.44,
	unfundedContributions: 0,
	fundingReceived: 0,
	employerCost: 3461.93,
	lines: [
		line('BASIC', 'EARNING', 'BASE', 3000),
		line('ABSENCE', 'ABSENCE', 'WORK_DAY', 136.36, 1),
		line('OVERTIME', 'EARNING', 'WORK_DAY', 94.41, 4, 'OT-1.5X')
	],
	contributions: new Map([
		[
			'FUND',
			{ scheme_code: 'FUND', label: 'FUND', base: 2958.05, employee: 591.61, employer: 503.88 }
		]
	])
};

const text = (pdf) => [...pdf.matchAll(/\((.*)\) Tj/g)].map((match) => match[1]);

const render = (overtimePeriod) =>
	text(
		payslipPdf({
			employer: 'Norbital Pte. Ltd.',
			period: '2026-09',
			salaryPeriod: { start: '2026-09-01', end: '2026-09-30' },
			overtimePeriod,
			payDate: '2026-09-30',
			payslip
		})
	);

test('the payslip PDF states every Third Schedule particular with deductions signed', () => {
	const lines = render({ start: '2026-08-21', end: '2026-09-20' });
	for (const expected of [
		'Employer: Norbital Pte. Ltd.',
		'Employee: Tan Ah Kow \\(N0001\\)',
		'Salary period: 2026-09-01 to 2026-09-30',
		'BASIC | 3000.00 | SGD',
		'ABSENCE | -136.36 | SGD',
		'OVERTIME OT-1.5X | 94.41 | SGD',
		'Overtime period: 2026-08-21 to 2026-09-20',
		'Overtime hours: 4.00',
		'Overtime pay: 94.41 SGD paid 2026-09-30',
		'FUND | -591.61 | 503.88',
		'Gross: 2958.05 SGD',
		'Total deductions: -591.61 SGD',
		'Net pay: 2366.44 SGD paid 2026-09-30'
	])
		assert.ok(lines.includes(expected), `missing ${expected}\n${lines.join('\n')}`);
});

test('the overtime period is printed only where it differs from the salary period (item 7)', () => {
	const lines = render({ start: '2026-09-01', end: '2026-09-30' });
	assert.ok(!lines.some((row) => row.startsWith('Overtime period:')));
	assert.ok(lines.includes('Overtime hours: 4.00'));
});
