// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	expandOvertimeMonthGrid,
	expandRosterMonthGrid,
	expandTimeMonthGrid,
	isLongFormImportHeaders,
	isMonthGridImportHeaders
} from '../src/data/collection/work_days/lib/import-month-grid.ts';
import { isYearMonth } from '../src/lib/period.ts';
import { schedulingImportPayload } from '../src/data/collection/work_days/lib/import-workbook.ts';
import { WorkbookImportError } from '../src/lib/workbook-rows.ts';

test('a payroll month is YYYY-MM', () => {
	assert.equal(isYearMonth('2026-05'), true);
	assert.equal(isYearMonth('2026-13'), false);
});

test('month-grid headers are distinct from a long-form person-day sheet', () => {
	assert.equal(isLongFormImportHeaders(['employee_number', 'work_date', 'shift_code']), true);
	assert.equal(isMonthGridImportHeaders(['employee_number', 'work_date', 'shift_code']), false);
	assert.equal(isMonthGridImportHeaders(['employee_number', '1', '2', '31']), true);
	assert.equal(isMonthGridImportHeaders(['employee_number', '2026-05-01', '2026-05-02']), true);
});

test('a roster month grid expands filled cells and omits blanks', () => {
	const rows = expandRosterMonthGrid(
		{
			sheetName: 'Roster',
			headers: ['employee_number', '1', '2', '3'],
			rows: [
				{
					rowNumber: 2,
					cells: new Map([
						['employee_number', 'PUBEM0002'],
						['1', '7.5AM'],
						['2', ''],
						['3', 'REST']
					])
				}
			]
		},
		'2026-05'
	);
	assert.deepEqual(rows, [
		{ employee_number: 'PUBEM0002', work_date: '2026-05-01', shift_code: '7.5AM' },
		{ employee_number: 'PUBEM0002', work_date: '2026-05-03', shift_code: 'REST' }
	]);
});

test('a time-entry month grid reads closed ranges, open punches and several intervals to a cell', () => {
	const rows = expandTimeMonthGrid(
		{
			sheetName: 'Time entries',
			headers: ['employee_number', '4', '5', '6', '7'],
			rows: [
				{
					rowNumber: 2,
					cells: new Map([
						['employee_number', 'PUBEM0023'],
						['4', '20:30-05:15'],
						['5', ''],
						['6', '20:31'],
						['7', '08:00-12:00; 13:00-17:00\n18:00-20:00']
					])
				}
			]
		},
		'2026-05'
	);
	assert.deepEqual(rows, [
		{
			employee_number: 'PUBEM0023',
			work_date: '2026-05-04',
			clock_in: '20:30',
			clock_out: '05:15'
		},
		{ employee_number: 'PUBEM0023', work_date: '2026-05-06', clock_in: '20:31' },
		// a split shift: one row per interval, in the order the cell lists them
		...[
			['08:00', '12:00'],
			['13:00', '17:00'],
			['18:00', '20:00']
		].map(([clock_in, clock_out]) => ({
			employee_number: 'PUBEM0023',
			work_date: '2026-05-07',
			clock_in,
			clock_out
		}))
	]);
});

test('an overtime month grid reads half-hour cells and omits blanks', () => {
	const rows = expandOvertimeMonthGrid(
		{
			sheetName: 'Overtime',
			headers: ['employee_number', '4', '5', '6', '7'],
			rows: [
				{
					rowNumber: 2,
					cells: new Map([
						['employee_number', 'PUBEM0023'],
						['4', 3],
						['5', ''],
						['6', '2.5'],
						['7', 0]
					])
				}
			]
		},
		'2026-05'
	);
	assert.deepEqual(rows, [
		{ employee_number: 'PUBEM0023', work_date: '2026-05-04', overtime_hours: 3 },
		{ employee_number: 'PUBEM0023', work_date: '2026-05-06', overtime_hours: 2.5 },
		{ employee_number: 'PUBEM0023', work_date: '2026-05-07', overtime_hours: 0 }
	]);
});

test('a long-form overtime row carries prior consent, and a declared input column even at zero hours', () => {
	const grids = new Map([
		[
			'Settings',
			[
				['Setting', 'Value'],
				['legal_entity', 'Test Co'],
				['month', '2026-01']
			]
		],
		[
			'Overtime',
			[
				[
					'employee_number',
					'work_date',
					'overtime_hours',
					'overtime_consented_at',
					'normal_hours_redistribution_agreed_at'
				],
				['E1', '2026-01-05', '1', '2026-01-05T08:00:00+07:00', ''],
				['E1', '2026-01-06', '0', '', '2026-01-05T12:00:00+07:00']
			]
		]
	]);
	assert.deepEqual(schedulingImportPayload(grids).overtime, [
		{
			employee_number: 'E1',
			work_date: '2026-01-05',
			overtime_hours: 1,
			overtime_consented_at: '2026-01-05T01:00:00.000Z'
		},
		{
			employee_number: 'E1',
			work_date: '2026-01-06',
			overtime_hours: 0,
			facts: { normal_hours_redistribution_agreed_at: '2026-01-05T05:00:00.000Z' }
		}
	]);
});

test('an overtime cell outside 0 to 24 refuses the sheet by name; its step is the write’s to judge', () => {
	const read = (cell: unknown) =>
		expandOvertimeMonthGrid(
			{
				sheetName: 'Overtime',
				headers: ['employee_number', '4'],
				rows: [
					{
						rowNumber: 2,
						cells: new Map([
							['employee_number', 'PUBEM0023'],
							['4', cell]
						])
					}
				]
			},
			'2026-05'
		);
	// The keying step is the governing version's `overtime_unit_hours`, judged at the write.
	assert.equal(read('2.3')[0].overtime_hours, 2.3);
	assert.throws(() => read(-1), /cannot be negative/);
	assert.throws(() => read(25), /cannot exceed the 24 hours/);
	assert.throws(() => read('three'), /is not a number of hours/);
});

test('the workbook reader refuses a slashed work_date by name, before any write', () => {
	const grids = new Map([
		[
			'Settings',
			[
				['Setting', 'Value'],
				['legal_entity', 'Public Fixture Co'],
				['month', '2026-05']
			]
		],
		[
			'Roster',
			[
				['employee_number', 'work_date', 'shift_code'],
				['PUB-EMP-0001', '04/05/2026', 'OFF']
			]
		]
	]);
	assert.throws(
		() => schedulingImportPayload(grids),
		(error) => error instanceof WorkbookImportError && /04\/05\/2026/.test(error.message)
	);
});
