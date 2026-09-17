import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import {
	asRecord,
	bearerHeaders,
	commandSentence,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import { writeRows } from './helpers/write.ts';
import { workbookGrids, WorkbookImportError } from '../src/lib/workbook-rows.ts';
import { schedulingImportPayload } from '../src/collections/work_days/lib/import-workbook.ts';
import {
	COMPANY_ID,
	EMPLOYMENT_ID,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const ROSTER_SHEET_NAME = 'Roster';
const ROSTER_HEADERS = ['employee_number', 'work_date', 'shift_code'] as const;
const SETTINGS_SHEET_NAME = 'Settings';

/** Every day of a month, as YYYY-MM-DD. */
const daysOf = (month: string): string[] => {
	const [year, monthNumber] = month.split('-').map(Number) as [number, number];
	const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return Array.from(
		{ length: count },
		(_, index) => `${month}-${String(index + 1).padStart(2, '0')}`
	);
};

/**
 * A roster of record covers every employed day of its month, so a person the sheet names is
 * named on every day: the day under test carries its code, the rest OFF. PUB-EMP-0001 has been
 * employed since 2021, so every day of the month is one the sheet must state.
 */
const wholeMonth = (
	month: string,
	employeeNumber: string,
	assignments: Readonly<Record<string, string>> = {}
): ReadonlyArray<readonly [string, string, string]> =>
	daysOf(month).map((date) => [employeeNumber, date, assignments[date] ?? 'OFF'] as const);

const rosterImportBody = (
	month: string,
	rows: ReadonlyArray<readonly [string, string, string]>
) => ({
	records: [
		{
			collection: 'work_days',
			id: crypto.randomUUID(),
			values: {
				legal_entity: 'Public Fixture Co',
				month,
				roster: rows.map(([employee_number, work_date, shift_code]) => ({
					employee_number,
					work_date,
					shift_code
				}))
			}
		}
	]
});

const importRecordsBody = (values: Readonly<Record<string, unknown>>) => ({
	records: [
		{
			collection: 'work_days',
			id: crypto.randomUUID(),
			values
		}
	]
});

const writeRosterXlsx = async (
	month: string,
	rows: ReadonlyArray<readonly [string, string, string]>
): Promise<Uint8Array> => {
	const dir = await mkdtemp(join(tmpdir(), 'hr-payroll-t18-'));
	const filePath = join(dir, 'roster.xlsx');
	const workbook = new ExcelJS.Workbook();
	const settings = workbook.addWorksheet(SETTINGS_SHEET_NAME);
	settings.addRow(['Setting', 'Value']);
	settings.addRow(['legal_entity', 'Public Fixture Co']);
	settings.addRow(['month', month]);
	const sheet = workbook.addWorksheet(ROSTER_SHEET_NAME);
	sheet.addRow([...ROSTER_HEADERS]);
	for (const row of rows) sheet.addRow([...row]);
	await workbook.xlsx.writeFile(filePath);
	const fileBytes = await readFile(filePath);
	return Uint8Array.from(fileBytes);
};

const rosterPayloadFromXlsx = async (
	month: string,
	rows: ReadonlyArray<readonly [string, string, string]>
) => {
	const bytes = await writeRosterXlsx(month, rows);
	const loaded = new ExcelJS.Workbook();
	await loaded.xlsx.load(bytes as never);
	return schedulingImportPayload(workbookGrids(loaded));
};

const UNKNOWN_EMPLOYEE_SENTENCE =
	'No approved employment contract covers PUB-EMP-9999 on 2026-03-04 in this legal entity.';

/**
 * I3 / H4: public-valid roster import commits the month and its roster of record; public-invalid
 * is 422 with the server sentence. Client `04/05/2026` is refused by the workbook reader without
 * regenerating an xlsx.
 */
test(
	'public seed roster import commits a whole month for PUB-EMP-0001 and refuses unknown employee numbers',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-i3-import');
		try {
			const headers = bearerHeaders(session.credential);

			const valid = await postGuestCommand(
				session.host.baseUrl,
				'collections.import',
				rosterImportBody(
					'2026-03',
					wholeMonth('2026-03', 'PUB-EMP-0001', { '2026-03-01': 'REST' })
				),
				headers
			);
			assert.ok(
				valid.status >= 200 && valid.status < 300,
				`valid roster import ${valid.status}: ${JSON.stringify(valid.value)}`
			);
			const imported = asRecord(valid.value, 'collections.import').imported;
			assert.equal(imported, 31, `expected the whole month, got ${JSON.stringify(valid.value)}`);
			const rosters = (await session.query('select period from rosters where employment_id = $1', [
				EMPLOYMENT_ID
			])) as ReadonlyArray<{ readonly period: string }>;
			assert.deepEqual(
				rosters.map((row) => row.period),
				['2026-03'],
				'the sheet names the person, so the month is their roster of record'
			);

			// A roster is whole or it is not one: a person named on one day is missing thirty.
			const partial = await postGuestCommand(
				session.host.baseUrl,
				'collections.import',
				rosterImportBody('2026-04', [['PUB-EMP-0001', '2026-04-01', 'OFF']]),
				headers
			);
			assert.equal(partial.status, 422, JSON.stringify(partial.value));
			assert.match(commandSentence(partial), /missing days in 2026-04/);
			assert.match(commandSentence(partial), /PUB-EMP-0001: 2026-04-02, 2026-04-03/);

			const invalid = await postGuestCommand(
				session.host.baseUrl,
				'collections.import',
				rosterImportBody('2026-03', [['PUB-EMP-9999', '2026-03-04', 'OFF']]),
				headers
			);
			assert.equal(
				invalid.status,
				422,
				`invalid roster import expected 422, got ${invalid.status}: ${JSON.stringify(invalid.value)}`
			);
			assert.equal(commandSentence(invalid), UNKNOWN_EMPLOYEE_SENTENCE);
		} finally {
			await session.stop();
		}
	}
);

test(
	'public seed roster xlsx commits a whole month for PUB-EMP-0001 and refuses unknown employee numbers',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-t18-xlsx');
		try {
			const headers = bearerHeaders(session.credential);

			const validPayload = await rosterPayloadFromXlsx(
				'2026-03',
				wholeMonth('2026-03', 'PUB-EMP-0001', { '2026-03-01': 'REST' })
			);
			const valid = await postGuestCommand(
				session.host.baseUrl,
				'collections.import',
				importRecordsBody(validPayload),
				headers
			);
			assert.ok(
				valid.status >= 200 && valid.status < 300,
				`valid roster xlsx import ${valid.status}: ${JSON.stringify(valid.value)}`
			);
			const imported = asRecord(valid.value, 'collections.import').imported;
			assert.equal(
				imported,
				31,
				`expected the whole month from xlsx, got ${JSON.stringify(valid.value)}`
			);

			const invalidPayload = await rosterPayloadFromXlsx('2026-03', [
				['PUB-EMP-9999', '2026-03-04', 'OFF']
			]);
			const invalid = await postGuestCommand(
				session.host.baseUrl,
				'collections.import',
				importRecordsBody(invalidPayload),
				headers
			);
			assert.equal(
				invalid.status,
				422,
				`invalid roster xlsx import expected 422, got ${invalid.status}: ${JSON.stringify(invalid.value)}`
			);
			assert.equal(commandSentence(invalid), UNKNOWN_EMPLOYEE_SENTENCE);
		} finally {
			await session.stop();
		}
	}
);

test(
	'public seed roster xlsx refuses a January month once January 2026 is paid',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-t18-lock');
		try {
			const headers = bearerHeaders(session.credential);
			const created = await writeRows(
				session,
				'payroll_runs',
				'create',
				[{ company_id: COMPANY_ID, period: JANUARY_2026 }],
				headers
			);
			assert.ok(
				created.status >= 200 && created.status < 300,
				`create January payroll ${created.status}: ${JSON.stringify(created.value)}`
			);
			requireAccepted(created.value, 'create January payroll');

			// The lock is the payslip's, so paying the run means paying its slips. Marking the run
			// alone would leave a run that disagrees with its own payslips — a state no write path
			// can produce, and one that locks nothing.
			await session.query(
				`update payslips set paid_at = now() where payroll_run_id in
					(select id from payroll_runs where company_id = $1 and period = $2)`,
				[COMPANY_ID, JANUARY_2026]
			);

			// The seed stores no January days, so the file's days are creates, and a create on a day
			// inside a paid window is the `work_days` write hook's to refuse.
			const payload = await rosterPayloadFromXlsx(
				JANUARY_2026,
				wholeMonth(JANUARY_2026, 'PUB-EMP-0001', { '2026-01-18': 'REST' })
			);
			const locked = await postGuestCommand(
				session.host.baseUrl,
				'collections.import',
				importRecordsBody(payload),
				headers
			);
			assert.equal(
				locked.status,
				422,
				`locked January xlsx import expected 422, got ${locked.status}: ${JSON.stringify(locked.value)}`
			);
			assert.match(commandSentence(locked), /inside paid payroll 2026-01/);
		} finally {
			await session.stop();
		}
	}
);

test('schedulingImportPayload refuses a slashed work_date without opening an xlsx', () => {
	assert.throws(
		() =>
			schedulingImportPayload(
				new Map([
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
				])
			),
		(error: unknown) => {
			assert.ok(error instanceof WorkbookImportError, String(error));
			assert.match(error.message, /04\/05\/2026/);
			return true;
		}
	);
});
