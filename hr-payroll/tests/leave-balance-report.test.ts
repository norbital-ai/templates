// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The leave balance export over the profile's own balance rows: the masthead, the Employee band and
 * one band per leave type, and a row whose Total less Taken and Forfeit is the profile's balance.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { leaveBalanceSummaries } from '../src/lib/leave/summary.ts';
import { leaveBalanceWorkbook } from '../src/lib/leave/balance-report.ts';
import {
	annualWindow,
	approve,
	id,
	leaveContext,
	timeOff
} from './helpers/manual-leave-context.ts';

const read = async (workbook) => {
	const loaded = new ExcelJS.Workbook();
	await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
	return loaded.getWorksheet('Leave balances');
};
const figures = (sheet, row) =>
	Array.from({ length: 9 }, (_, index) => sheet.getCell(row, 4 + index).value);
const report = (context, asOf) =>
	leaveBalanceWorkbook({
		company: 'Nihon Precision Sdn Bhd',
		asOf,
		rows: [
			{
				employee_number: 'NHPMY0005',
				name: 'TAUFIK BIN MOHAMAD',
				service_start: '2010-07-05',
				balances: leaveBalanceSummaries(context, id(1), asOf)
			}
		]
	});

test('the export heads one band per leave type and prints the profile balance', async () => {
	const context = leaveContext();
	approve(context, timeOff('2026-04-01', '2026-04-04'));
	const sheet = await read(report(context, '2026-06-01'));
	assert.equal(sheet.getCell(1, 1).value, 'Nihon Precision Sdn Bhd');
	assert.equal(sheet.getCell(2, 1).value, 'LEAVE CONSOLIDATE REPORT');
	assert.equal(sheet.getCell(3, 1).value, 'As at 01-06-2026');
	assert.equal(sheet.getCell(4, 1).value, 'Employee');
	assert.equal(sheet.getCell(4, 4).value, 'Annual leave');
	assert.equal(sheet.getCell(4, 4).font.bold, true);
	assert.ok(sheet.model.merges.includes('D4:L4'), 'the type band spans its nine columns');
	assert.deepEqual(sheet.getRow(5).values.slice(1), [
		'Employee Code',
		'Name',
		'Leave Calculation Date',
		'Year',
		'Elig.',
		'B.F.',
		'Forfeit',
		'Credit',
		'Earn',
		'Total',
		'Taken',
		'Bal.',
		'Report notes'
	]);
	assert.deepEqual(sheet.views[0], {
		...sheet.views[0],
		state: 'frozen',
		xSplit: 3,
		ySplit: 5
	});
	assert.equal(sheet.getCell(6, 1).value, 'NHPMY0005');
	assert.equal(sheet.getCell(6, 2).value, 'TAUFIK BIN MOHAMAD');
	assert.equal(sheet.getCell(6, 3).value.toISOString().slice(0, 10), '2010-07-05');
	assert.equal(sheet.getCell(6, 3).numFmt, 'dd-mm-yyyy');
	assert.equal(sheet.getCell(6, 5).numFmt, '0.00');
	// Year, Elig., B.F., Forfeit, Credit, Earn, Total, Taken, Bal.
	assert.deepEqual(figures(sheet, 6), [2026, 12, 0, 0, 0, 0, 12, 4, 8]);
	assert.equal(leaveBalanceSummaries(context, id(1), '2026-06-01')[0].balance, 8);
});

test('a carried credit is brought forward and its unused days forfeit', async () => {
	const context = leaveContext();
	approve(context, timeOff('2026-06-01', '2026-06-08'));
	approve(
		context,
		{
			from_date: annualWindow.start,
			to_date: annualWindow.end,
			destination_from: '2027-01-01',
			destination_to: '2027-12-31',
			days: 3,
			available_from: '2027-01-01',
			expires_on: '2027-03-31',
			effective_on: '2027-01-15',
			reason: 'HR-approved transfer'
		},
		11
	);
	approve(context, timeOff('2027-05-03', '2027-05-04'), 12);
	const sheet = await read(report(context, '2027-06-01'));
	assert.deepEqual(figures(sheet, 6), [2027, 12, 3, 3, 0, 0, 15, 2, 10]);
	// The source year: the carry out is a signed credit, so Total less Taken is still its balance.
	const source = await read(report(context, '2026-12-31'));
	assert.deepEqual(figures(source, 6), [2026, 12, 0, 0, -3, 0, 9, 8, 1]);
});

test('an unresolved person remains identified with blank balance cells and an explicit report note', async () => {
	const context = leaveContext();
	const sheet = await read(
		leaveBalanceWorkbook({
			company: 'Example',
			asOf: '2026-06-01',
			rows: [
				{
					employee_number: 'GOOD',
					name: 'Calculated person',
					service_start: '2025-01-01',
					balances: leaveBalanceSummaries(context, id(1), '2026-06-01')
				},
				{
					employee_number: 'ISSUE',
					name: 'Unresolved person',
					service_start: '2025-01-01',
					balances: [],
					issue: 'Prior-year leave is overdrawn before automatic carry.'
				}
			]
		})
	);
	assert.equal(sheet.getCell('A7').value, 'ISSUE');
	assert.equal(sheet.getCell('B7').value, 'Unresolved person');
	for (let column = 4; column <= 12; column++) assert.equal(sheet.getCell(7, column).value, null);
	assert.equal(sheet.getCell('M7').value, 'Prior-year leave is overdrawn before automatic carry.');
	assert.equal(sheet.getCell('L6').value, 12);
});

test('an entirely unresolved report still exports every identity and its issue', async () => {
	const sheet = await read(
		leaveBalanceWorkbook({
			company: 'Example',
			asOf: '2026-06-01',
			rows: [
				{
					employee_number: 'ISSUE',
					name: 'Unresolved person',
					service_start: '2025-01-01',
					balances: [],
					issue: 'Missing opening input.'
				}
			]
		})
	);
	assert.equal(sheet.getCell('A6').value, 'ISSUE');
	assert.equal(sheet.getCell('D5').value, 'Report notes');
	assert.equal(sheet.getCell('D6').value, 'Missing opening input.');
});
