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
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
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
	paidDate: '2026-09-30',
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

// Read the serialized document through an independent PDF reader, not its content-stream syntax.
const text = async (bytes) => {
	const document = await getDocument({ data: bytes, useSystemFonts: false }).promise;
	const rows = [];
	for (let number = 1; number <= document.numPages; number++) {
		const content = await (await document.getPage(number)).getTextContent();
		let row = '';
		for (const item of content.items) {
			if (!('str' in item)) continue;
			row += item.str;
			if (item.hasEOL) {
				rows.push(row.replace(/\s+/g, ' ').trim());
				row = '';
			}
		}
		if (row) rows.push(row.replace(/\s+/g, ' ').trim());
	}
	await document.destroy();
	return rows;
};
const render = async (overtimePeriod) =>
	text(
		await payslipPdf({
			employer: 'Norbital Pte. Ltd.',
			period: '2026-09',
			salaryPeriod: { start: '2026-09-01', end: '2026-09-30' },
			overtimePeriod,
			payDate: '2026-09-30',
			payslip
		})
	);

test('the payslip PDF states every Third Schedule particular in sections, deductions signed', async () => {
	const lines = await render({ start: '2026-08-21', end: '2026-09-20' });
	for (const expected of [
		'Employer: Norbital Pte. Ltd.',
		'Employee: Tan Ah Kow (N0001)',
		'Salary period: 2026-09-01 to 2026-09-30',
		'EARNINGS',
		'BASIC 3,000.00',
		'ABSENCE 1 -136.36',
		'OVERTIME OT-1.5X 4 94.41',
		'Gross 2,958.05',
		'DEDUCTIONS',
		'FUND on 2,958.05 -591.61',
		'Total deductions -591.61',
		'Net pay 2,366.44 SGD',
		'Paid 2026-09-30',
		'EMPLOYER CONTRIBUTIONS (not deducted)',
		'FUND on 2,958.05 503.88',
		'Employer cost 3,461.93 SGD',
		'Overtime period: 2026-08-21 to 2026-09-20',
		'Overtime hours: 4.00',
		'Overtime pay: 94.41 SGD paid 2026-09-30'
	])
		assert.ok(lines.includes(expected), `missing ${expected}\n${lines.join('\n')}`);
});

test('the overtime period is printed only where it differs from the salary period (item 7)', async () => {
	const lines = await render({ start: '2026-09-01', end: '2026-09-30' });
	assert.ok(!lines.some((row) => row.startsWith('Overtime period:')));
	assert.ok(lines.includes('Overtime hours: 4.00'));
});

for (const [currency, employer, employee] of [
	['VND', 'Công ty Nguyễn', 'Nguyễn Thị Đặng'],
	['JPY', '株式会社東京', '山田太郎'],
	['TWD', '臺灣股份有限公司', '陳美玲'],
	['CNY', '北京有限公司', '张晓明'],
	['THB', 'บริษัทไทย', 'สมชาย ใจดี'],
	['SGD', 'Cafe\u0301 Pte. Ltd.', 'Jose\u0301 García']
])
	test(`payslip PDF preserves original ${currency} Unicode identity and money`, async () => {
		const rows = await text(
			await payslipPdf({
				employer,
				period: '2026-09',
				salaryPeriod: { start: '2026-09-01', end: '2026-09-30' },
				overtimePeriod: { start: '2026-09-01', end: '2026-09-30' },
				payDate: '2026-09-30',
				payslip: { ...payslip, employeeName: employee, currency }
			})
		);
		assert.ok(rows.includes(`Employer: ${employer}`), rows.join('\n'));
		assert.ok(rows.includes(`Employee: ${employee} (N0001)`), rows.join('\n'));
		assert.ok(rows.includes(`Net pay 2,366.44 ${currency}`), rows.join('\n'));
	});

test('payslip PDF refuses unsupported glyphs instead of replacing the legal identity', async () => {
	await assert.rejects(
		payslipPdf({
			employer: 'Unsupported 🦄',
			period: '2026-09',
			salaryPeriod: { start: '2026-09-01', end: '2026-09-30' },
			overtimePeriod: { start: '2026-09-01', end: '2026-09-30' },
			payDate: '2026-09-30',
			payslip
		}),
		/no supported glyph/
	);
});

test('mixed-script payslip names fit within the production file limit without identity changes', async () => {
	const employer = 'Công ty Nguyễn 株式会社東京 臺灣 北京 บริษัทไทย';
	const employee = 'Nguyễn Thị Đặng 山田太郎 陳美玲 张晓明 สมชาย ใจดี';
	const bytes = await payslipPdf({
		employer,
		period: '2026-09',
		salaryPeriod: { start: '2026-09-01', end: '2026-09-30' },
		overtimePeriod: { start: '2026-09-01', end: '2026-09-30' },
		payDate: '2026-09-30',
		payslip: { ...payslip, employeeName: employee }
	});
	assert.ok(
		bytes.length < 2 * 1024 * 1024,
		`${bytes.length} bytes leaves insufficient file-limit headroom`
	);
	const rows = await text(bytes);
	assert.ok(rows.includes(`Employer: ${employer}`));
	assert.ok(rows.includes(`Employee: ${employee} (N0001)`));
});

test('payslip PDF refuses an illegibly long name without altering the identity', async () => {
	await assert.rejects(
		payslipPdf({
			employer: 'Norbital',
			period: '2026-09',
			salaryPeriod: { start: '2026-09-01', end: '2026-09-30' },
			overtimePeriod: { start: '2026-09-01', end: '2026-09-30' },
			payDate: '2026-09-30',
			payslip: { ...payslip, employeeName: '山田'.repeat(150) }
		}),
		/cannot render.*legibly/
	);
});

test('an unpaid payslip names the scheduled date without asserting payment or paid overtime', async () => {
	const rows = await text(
		await payslipPdf({
			employer: 'Synthetic employer',
			period: '2026-09',
			salaryPeriod: { start: '2026-09-01', end: '2026-09-30' },
			overtimePeriod: { start: '2026-09-01', end: '2026-09-30' },
			payDate: '2026-09-30',
			payslip: { ...payslip, paidDate: null }
		})
	);
	assert.ok(rows.includes('Scheduled pay date: 2026-09-30'));
	assert.ok(rows.includes('Overtime pay: 94.41 SGD scheduled pay date 2026-09-30'));
	assert.ok(!rows.some((row) => /^Paid | paid /.test(row)));
});

test('a paid early leaver prints the individual actual date for net and overtime payment', async () => {
	const rows = await text(
		await payslipPdf({
			employer: 'Synthetic employer',
			period: '2026-09',
			salaryPeriod: { start: '2026-09-01', end: '2026-09-30' },
			overtimePeriod: { start: '2026-09-01', end: '2026-09-30' },
			payDate: '2026-09-30',
			payslip: { ...payslip, paidDate: '2026-09-12' }
		})
	);
	assert.ok(rows.includes('Pay date: 2026-09-12'));
	assert.ok(rows.includes('Paid 2026-09-12'));
	assert.ok(rows.includes('Overtime pay: 94.41 SGD paid 2026-09-12'));
	assert.ok(!rows.some((row) => row.includes('2026-09-30') && /Paid|paid/.test(row)));
});

test('long proration formula and earning label survive caption wrapping with the exact monetary column', async () => {
	const detail = '1,748.00 × 4/31 + 1,748.00 × 8/31 + 1,748.00 × 12/31 + 1,748.00 × 7/31';
	const label = 'Synthetic contractual basic salary with all effective employment segments';
	const rows = await text(
		await payslipPdf({
			employer: 'Synthetic employer',
			period: '2026-09',
			salaryPeriod: { start: '2026-09-01', end: '2026-09-30' },
			overtimePeriod: { start: '2026-09-01', end: '2026-09-30' },
			payDate: '2026-09-30',
			payslip: { ...payslip, lines: [{ ...line('BASIC', 'EARNING', 'BASE', 1748), label, detail }] }
		})
	);
	assert.ok(rows.join(' ').includes(detail));
	assert.ok(rows.join(' ').includes(label));
	assert.ok(rows.some((row) => row.endsWith('1,748.00')));
});
