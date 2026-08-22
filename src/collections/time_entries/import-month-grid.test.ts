// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	expandRosterMonthGrid,
	expandTimeMonthGrid,
	isLongFormImportHeaders,
	isMonthGridImportHeaders
} from './import-month-grid.ts';
import { calendarDaysInMonth, isYearMonth } from '../../lib/period.ts';

test('May 2026 has 31 calendar days', () => {
	assert.equal(calendarDaysInMonth('2026-05').length, 31);
	assert.equal(calendarDaysInMonth('2026-05')[0], '2026-05-01');
	assert.equal(calendarDaysInMonth('2026-05').at(-1), '2026-05-31');
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
						['employee_number', 'NHPMY0002'],
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
		{ employee_number: 'NHPMY0002', work_date: '2026-05-01', shift_code: '7.5AM' },
		{ employee_number: 'NHPMY0002', work_date: '2026-05-03', shift_code: 'REST' }
	]);
});

test('a time-entry month grid reads closed ranges and open punches', () => {
	const rows = expandTimeMonthGrid(
		{
			sheetName: 'Time entries',
			headers: ['employee_number', '4', '5', '6'],
			rows: [
				{
					rowNumber: 2,
					cells: new Map([
						['employee_number', 'NHPMY0023'],
						['4', '20:30-05:15'],
						['5', ''],
						['6', '20:31']
					])
				}
			]
		},
		'2026-05'
	);
	assert.deepEqual(rows, [
		{
			employee_number: 'NHPMY0023',
			work_date: '2026-05-04',
			clock_in: '20:30',
			clock_out: '05:15'
		},
		{ employee_number: 'NHPMY0023', work_date: '2026-05-06', clock_in: '20:31' }
	]);
});
