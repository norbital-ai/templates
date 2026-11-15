import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import type { Worksheet } from 'exceljs';
import {
	sheetsOf,
	workbookOf,
	type ListingRead,
	type Sheet
} from '../../src/lib/export_format_configuration/salary_listing_export.ts';
import type { PayslipBreakdown } from '../../src/lib/payroll_engine/payslip_breakdown.ts';

type Line = PayslipBreakdown['lines'][number];
const line = (over: Partial<Line>): Line => ({
	code: 'ALPHA',
	label: 'Alpha allowance',
	source: 'allowance_catalog',
	subtotal: 'EARNINGS',
	party: 'EMPLOYEE',
	direction: 'ADD',
	amount: 200,
	...over
});
const sample: Sheet = {
	company: 'Example company',
	currency: 'MYR',
	period: '2026-02',
	offCycle: false,
	people: [
		{
			code: '001',
			name: 'Example employee',
			position: 'Engineer',
			department: 'Operations',
			identity: '000123',
			joined: '2026-01-01',
			left: '',
			gross: 1260,
			net: 990,
			tax: 75,
			contributions: 25,
			employer: 5,
			breakdown: {
				checkpoints: [
					{ code: 'BASIC', name: 'Basic salary', value: 1000 },
					{ code: 'PRORATED', name: 'Prorated salary', value: 900 },
					{ code: 'PAID_BASIC', name: 'Paid basic', value: 850 },
					{ code: 'EARNINGS', name: 'Earnings', value: 1050 },
					{ code: 'NET', name: 'Net pay', value: 960 }
				],
				lines: [
					line({
						code: 'BASIC',
						label: 'Basic salary',
						source: 'employment',
						subtotal: 'BASIC',
						amount: 1000
					}),
					line({
						code: 'JOIN',
						label: 'Joiner proration',
						source: 'employment',
						subtotal: 'PRORATED',
						direction: 'DEDUCT',
						amount: 100
					}),
					line({
						code: 'NPL',
						label: 'No pay leave',
						source: 'leave_catalog',
						subtotal: 'PAID_BASIC',
						direction: 'DEDUCT',
						amount: 50
					}),
					line({ quantity: 1, unit: 'MONTH' }),
					line({ amount: 40, period: '2026-01', quantity: 2, unit: 'DAY' }),
					line({ amount: 10, direction: 'DEDUCT', period: '2026-01' }),
					line({
						source: 'loan_catalog',
						label: 'Alpha loan',
						direction: 'DEDUCT',
						subtotal: 'NET',
						amount: 10
					}),
					line({ source: 'adhoc_catalog', label: 'Alpha payment', subtotal: 'NET', amount: 20 }),
					line({ source: 'allowance_catalog', party: 'EMPLOYER', amount: 25 }),
					line({
						code: 'CP38_INSTALMENT',
						label: 'CP38 instalment',
						source: 'adhoc_catalog',
						subtotal: 'NET',
						direction: 'DEDUCT',
						amount: 75
					}),
					line({
						code: 'RETIREMENT',
						label: 'Retirement',
						source: 'statutory_contribution_catalog',
						subtotal: 'NET',
						direction: 'DEDUCT',
						amount: 25
					}),
					line({
						code: 'RETIREMENT_EMPLOYER',
						source: 'statutory_contribution_catalog',
						party: 'EMPLOYER',
						amount: 40
					}),
					line({
						code: 'RETIREMENT_EMPLOYER',
						source: 'statutory_contribution_catalog',
						party: 'EMPLOYER',
						direction: 'DEDUCT',
						amount: 60,
						period: '2026-01'
					})
				],
				statutory: [{ code: 'RETIREMENT', kind: 'CONTRIBUTION', employee: 25, employer: 40 }]
			}
		}
	]
};
const headersOf = (ws: Worksheet) =>
	Array.from({ length: ws.columnCount }, (_, index) =>
		String(ws.getRow(4).getCell(index + 1).value ?? '')
	);

describe('catalogue salary listing', () => {
	it('combines periods once per catalogue and keeps families, parties and refunds distinct', () => {
		const workbook = workbookOf([sample]);
		const ws = workbook.getWorksheet('FEB 2026');
		assert.ok(ws);
		const headers = headersOf(ws);
		const value = (header: string) => {
			const column = headers.indexOf(header) + 1;
			assert.ok(column > 0, header);
			return ws.getRow(5).getCell(column).value;
		};
		assert.equal(headers.filter((header) => header === 'BASIC SALARY').length, 1);
		assert.equal(
			headers.filter((header) => header === 'ALPHA ALLOWANCE').length,
			2,
			'one employee and one employer column'
		);
		assert.equal(
			value('ALPHA ALLOWANCE'),
			230,
			'current and earlier-period differences share one column'
		);
		assert.equal(value('ALPHA LOAN'), -10);
		assert.equal(value('ALPHA PAYMENT'), 20);
		assert.equal(value('NO PAY LEAVE'), -50);
		assert.equal(
			value('PAID BASIC (PERIOD ONLY)'),
			850,
			'a saved current-period checkpoint stays separate from combined catalogue differences'
		);
		assert.equal(value('CP38 INSTALMENT'), -75);
		assert.equal(
			value('TAX WITHHELD'),
			75,
			'an instructed tax instalment alone still has its saved summary'
		);
		assert.equal(value('NET PAY'), 990, 'the saved net includes the earlier-period difference');
		assert.equal(headers.filter((header) => header === 'NET PAY').length, 1);
		assert.equal(value('GROSS PAY'), 1260);
		assert.equal(value('COST TO COMPANY'), 1095);
		const employerColumn = headers.lastIndexOf('RETIREMENT') + 1;
		assert.equal(
			ws.getRow(5).getCell(employerColumn).value,
			-20,
			'a net employer refund stays negative'
		);
		const employerAllowance = headers.lastIndexOf('ALPHA ALLOWANCE') + 1;
		assert.equal(ws.getRow(5).getCell(employerAllowance).value, 25);
		assert.ok(employerAllowance > headers.indexOf('NET PAY') + 1);
		const details = workbook.getWorksheet('Line details');
		assert.ok(details);
		assert.equal(details.rowCount, 14);
		assert.deepEqual(
			Array.from(
				{ length: details.columnCount },
				(_, index) => details.getRow(6).getCell(index + 1).value
			),
			[
				'FEB 2026',
				'001',
				'Example employee',
				'2026-02',
				'2026-01',
				'allowance_catalog',
				'ALPHA',
				'Alpha allowance',
				'EMPLOYEE',
				'EARNINGS',
				'ADD',
				2,
				'DAY',
				40,
				'MYR',
				'Example company'
			]
		);
		assert.equal(details.getRow(7).getCell(14).value, -10);
	});

	it('orders columns by catalogue identity rather than the amounts or correction direction', () => {
		const before = workbookOf([sample]).worksheets[0];
		const changed: Sheet = {
			...sample,
			people: sample.people.map((person) => ({
				...person,
				breakdown: {
					...person.breakdown,
					lines: person.breakdown.lines.map((own, index) => ({
						...own,
						amount: index * 999,
						direction: own.direction === 'ADD' ? 'DEDUCT' : 'ADD'
					}))
				}
			}))
		};
		const after = workbookOf([changed]).worksheets[0];
		assert.ok(before && after);
		assert.deepEqual(headersOf(after), headersOf(before));
	});

	it('writes a readable XLSX with unique run names and valid totals for empty runs', async () => {
		const original = workbookOf([sample, sample, { ...sample, people: [] }]);
		const reopened = new ExcelJSBrowser.Workbook();
		await reopened.xlsx.load(await original.xlsx.writeBuffer());
		assert.deepEqual(
			reopened.worksheets.map((ws) => ws.name),
			['FEB 2026', 'FEB 2026 (2)', 'FEB 2026 (3)', 'Line details']
		);
		const empty = reopened.getWorksheet('FEB 2026 (3)');
		assert.ok(empty);
		const net = headersOf(empty).indexOf('NET PAY') + 1;
		assert.deepEqual(empty.getCell(5, net).value, { formula: '0' });
		assert.equal(
			reopened.getWorksheet('Line details')?.getRow(15).getCell(1).value,
			'FEB 2026 (2)'
		);
	});

	it('refuses missing or invalid saved data instead of exporting incomplete payroll', () => {
		const [person] = sample.people;
		assert.ok(person);
		const slip: ListingRead['slips'][number] = {
			payroll_run_id: 'run',
			employee_id: 'person',
			gross_earnings: '1260',
			net_pay: '990',
			tax_withheld: '75',
			employee_statutory: '25',
			employer_cost: '5',
			breakdown: person.breakdown,
			employment_id: { employee_number: '001', employee_id: { name: person.name } }
		};
		const read: ListingRead = {
			runs: [{ id: 'run', period: '2026-02', kind: 'ON_CYCLE', currency: 'MYR' }],
			slips: [slip],
			stints: []
		};
		assert.equal(sheetsOf(read)[0]?.people.length, 1);
		for (const bad of [
			{ ...slip, employment_id: null },
			{ ...slip, breakdown: {} },
			{ ...slip, tax_withheld: undefined },
			{ ...slip, net_pay: 'not money' },
			{ ...slip, breakdown: { ...person.breakdown, lines: [line({ direction: 'UNKNOWN' })] } }
		])
			assert.throws(() => sheetsOf({ ...read, slips: [bad] }), /salary listing/);
	});
});
