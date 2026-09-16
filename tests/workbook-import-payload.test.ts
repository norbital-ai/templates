// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { Effect } from 'effect';
import { schedulingImportPayload } from '../src/collections/work_days/lib/import-workbook.ts';
import { importPayloadFromGrids } from '../src/lib/ui/workbook-import-payload.ts';
import { workbookGrids, WorkbookImportError } from '../src/lib/workbook-rows.ts';

const README = [
	['Scheduling workbook — one legal entity, one month'],
	[],
	['One row per person per day.']
];
const SETTINGS = [
	['Setting', 'Value'],
	['legal_entity', 'Public Fixture Co'],
	['month', '2026-05']
];
const ROSTER_HEADERS = ['employee_number', 'work_date', 'shift_code'];
const VALID_ROSTER_ROWS = [
	['PUBEM0002', '2026-05-01', '7.5AM'],
	['PUBEM0002', '2026-05-02', '7.5AM'],
	['PUBEM0002', '2026-05-03', 'REST'],
	['PUBEM0002', '2026-05-04', '7.5AM'],
	['PUBEM0002', '2026-05-05', '7.5AM'],
	['PUBEM0023', '2026-05-04', 'AM0830'],
	['PUBEM0023', '2026-05-05', 'PM2030'],
	['PUBEM0023', '2026-05-06', 'OFF'],
	['PUBEM0023', '2026-05-07', '']
];

function fillWorkbook(sheets) {
	const workbook = new ExcelJS.Workbook();
	for (const [name, rows] of sheets) {
		const worksheet = workbook.addWorksheet(name);
		for (const row of rows) worksheet.addRow(row);
	}
	return workbook;
}

async function gridsFromSheets(sheets) {
	const workbook = fillWorkbook(sheets);
	const reloaded = new ExcelJS.Workbook();
	const buffer = await workbook.xlsx.writeBuffer();
	await reloaded.xlsx.load(buffer);
	return workbookGrids(reloaded);
}

function catchImportFailure(grids) {
	let caught = null;
	Effect.runSync(
		Effect.catch(importPayloadFromGrids(schedulingImportPayload, grids), (error) =>
			Effect.sync(() => {
				caught = error;
			})
		)
	);
	return caught;
}

test('a date-format refusal is an Effect failure Effect.catch can toast, not a defect', async () => {
	const grids = await gridsFromSheets([
		['Read me first', README],
		['Settings', SETTINGS],
		['Roster', [ROSTER_HEADERS, ['PUBEM0002', '04/05/2026', '7.5AM']]]
	]);
	const caught = catchImportFailure(grids);

	assert.ok(caught instanceof WorkbookImportError);
	assert.match(caught.message, /04\/05\/2026/);
});

test('a valid roster sheet still returns the payload so the toast catch stays quiet', async () => {
	const grids = await gridsFromSheets([
		['Read me first', README],
		['Settings', SETTINGS],
		['Roster', [ROSTER_HEADERS, ...VALID_ROSTER_ROWS]]
	]);
	assert.equal(catchImportFailure(grids), null);
	// The payload is the whole workbook: a sheet the file does not carry is absent, not empty.
	const payload = schedulingImportPayload(grids);
	assert.equal(payload.legal_entity, 'Public Fixture Co');
	assert.equal(payload.month, '2026-05');
	assert.equal(payload.roster.length, 8, 'a blank shift cell is no assignment');
	assert.equal('attendance' in payload, false);
	assert.equal('timezone' in payload, false);
});
