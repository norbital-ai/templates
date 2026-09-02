// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { Effect } from 'effect';
import { rosterImportPayload } from '../../src/collections/work_days/lib/import-workbook.ts';
import { importPayloadFromGrids } from '../../src/lib/ui/workbook-import-payload.ts';
import { workbookGrids, WorkbookImportError } from '../../src/lib/workbook-rows.ts';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const invalidRoster = path.join(fixturesDir, 'roster-import-invalid.xlsx');
const validRoster = path.join(fixturesDir, 'roster-import-valid.xlsx');

async function gridsFromFile(filePath: string) {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.readFile(filePath);
	return workbookGrids(workbook);
}

function catchImportFailure(buildPayload, grids) {
	let caught = null;
	Effect.runSync(
		Effect.catch(importPayloadFromGrids(buildPayload, grids), (error) =>
			Effect.sync(() => {
				caught = error;
			})
		)
	);
	return caught;
}

test('a date-format refusal is an Effect failure Effect.catch can toast, not a defect', async () => {
	const grids = await gridsFromFile(invalidRoster);
	const caught = catchImportFailure((next) => rosterImportPayload(next, 'roster:h4'), grids);

	assert.ok(caught instanceof WorkbookImportError);
	assert.match(caught.message, /04\/05\/2026/);
});

test('a valid roster reader still returns the payload so the toast catch stays quiet', async () => {
	const grids = await gridsFromFile(validRoster);
	const caught = catchImportFailure((next) => rosterImportPayload(next, 'roster:h4'), grids);

	assert.equal(caught, null);
});
