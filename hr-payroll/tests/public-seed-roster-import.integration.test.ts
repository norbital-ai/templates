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
	mutationPush,
	postGuestCommand,
	requireAccepted
} from '@norbital-ai/test-utilities';
import { workbookGrids, WorkbookImportError } from '../src/lib/workbook-rows.ts';
import { rosterImportPayload } from '../src/collections/work_days/lib/import-workbook.ts';
import {
	COMPANY_ID,
	JANUARY_2026,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const ROSTER_SHEET_NAME = 'Roster';
const ROSTER_HEADERS = ['employee_number', 'work_date', 'shift_code'] as const;

const rosterImportBody = (
	rosterId: string,
	rows: ReadonlyArray<Readonly<Record<string, string>>>
) => ({
	records: [
		{
			collection: 'work_days',
			id: crypto.randomUUID(),
			values: {
				sheet: 'ROSTER',
				roster_id: rosterId,
				rows
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

const createEmptyRoster = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	month: string
): Promise<string> => {
	const headers = bearerHeaders(session.credential);
	const created = await postGuestCommand(
		session.host.baseUrl,
		'collections.mutate',
		mutationPush(session.schemaFingerprint, {
			action: 'create',
			collection: 'rosters',
			values: {
				id: crypto.randomUUID(),
				company_id: COMPANY_ID,
				month,
				published_at: null
			}
		}),
		headers
	);
	assert.ok(
		created.status >= 200 && created.status < 300,
		`create ${month} roster ${created.status}: ${JSON.stringify(created.value)}`
	);
	requireAccepted(created.value, `create ${month} roster`);
	const rosterRows = (await session.query(
		`select id from rosters where company_id = $1 and month = $2`,
		[COMPANY_ID, month]
	)) as ReadonlyArray<{ readonly id: string }>;
	const rosterId = rosterRows[0]?.id;
	assert.equal(typeof rosterId, 'string', `expected a ${month} roster, got ${JSON.stringify(rosterRows)}`);
	return String(rosterId);
};

const writeRosterXlsx = async (
	rows: ReadonlyArray<readonly [string, string, string]>
): Promise<Uint8Array> => {
	const dir = await mkdtemp(join(tmpdir(), 'hr-payroll-t18-'));
	const filePath = join(dir, 'roster.xlsx');
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet(ROSTER_SHEET_NAME);
	sheet.addRow([...ROSTER_HEADERS]);
	for (const row of rows) sheet.addRow([...row]);
	await workbook.xlsx.writeFile(filePath);
	const fileBytes = await readFile(filePath);
	return Uint8Array.from(fileBytes);
};

const rosterPayloadFromXlsx = async (
	rosterId: string,
	rows: ReadonlyArray<readonly [string, string, string]>
) => {
	const bytes = await writeRosterXlsx(rows);
	const loaded = new ExcelJS.Workbook();
	await loaded.xlsx.load(bytes as never);
	return rosterImportPayload(workbookGrids(loaded), rosterId);
};

/**
 * I3 / H4: public-valid roster import commits; public-invalid is 422 with the server sentence.
 * Client `04/05/2026` is refused by the workbook reader without regenerating an xlsx.
 */
test(
	'public seed roster import accepts PUB-EMP-0001 OFF and refuses unknown employee numbers',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-i3-import');
		try {
			// Open-month materializes GENERATED plans; import refuses those as already assigned.
			// I3 commits against an empty draft roster — the same gate as “create the draft first”.
			const headers = bearerHeaders(session.credential);
			const rosterId = await createEmptyRoster(session, '2026-03');

			const valid = await postGuestCommand(
				session.host.baseUrl,
				'collections.import',
				rosterImportBody(rosterId, [
					{
						employee_number: 'PUB-EMP-0001',
						work_date: '2026-03-03',
						shift_code: 'OFF'
					}
				]),
				headers
			);
			assert.ok(
				valid.status >= 200 && valid.status < 300,
				`valid roster import ${valid.status}: ${JSON.stringify(valid.value)}`
			);
			const imported = asRecord(valid.value, 'collections.import').imported;
			assert.ok(
				typeof imported === 'number' && imported >= 1,
				`expected imported ≥ 1, got ${JSON.stringify(valid.value)}`
			);

			const invalid = await postGuestCommand(
				session.host.baseUrl,
				'collections.import',
				rosterImportBody(rosterId, [
					{
						employee_number: 'PUB-EMP-9999',
						work_date: '2026-03-04',
						shift_code: 'OFF'
					}
				]),
				headers
			);
			assert.equal(
				invalid.status,
				422,
				`invalid roster import expected 422, got ${invalid.status}: ${JSON.stringify(invalid.value)}`
			);
			assert.match(
				commandSentence(invalid),
				/These employee numbers are not employed by this legal entity/
			);
			assert.match(commandSentence(invalid), /PUB-EMP-9999/);
		} finally {
			await session.stop();
		}
	}
);

test(
	'public seed roster xlsx commits PUB-EMP-0001 OFF and refuses unknown employee numbers',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-t18-xlsx');
		try {
			const headers = bearerHeaders(session.credential);
			const rosterId = await createEmptyRoster(session, '2026-03');

			const validPayload = await rosterPayloadFromXlsx(rosterId, [
				['PUB-EMP-0001', '2026-03-03', 'OFF']
			]);
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
			assert.ok(
				typeof imported === 'number' && imported >= 1,
				`expected imported ≥ 1 from xlsx, got ${JSON.stringify(valid.value)}`
			);

			const invalidPayload = await rosterPayloadFromXlsx(rosterId, [
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
			assert.match(
				commandSentence(invalid),
				/These employee numbers are not employed by this legal entity/
			);
			assert.match(commandSentence(invalid), /PUB-EMP-9999/);
		} finally {
			await session.stop();
		}
	}
);

test(
	'public seed roster xlsx refuses a January day inside paid payroll 2026-01',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-t18-lock');
		try {
			const headers = bearerHeaders(session.credential);
			const created = await postGuestCommand(
				session.host.baseUrl,
				'collections.mutate',
				mutationPush(session.schemaFingerprint, {
					action: 'create',
					collection: 'payroll_runs',
					values: {
						id: crypto.randomUUID(),
						company_id: COMPANY_ID,
						period: JANUARY_2026
					}
				}),
				headers
			);
			assert.ok(
				created.status >= 200 && created.status < 300,
				`create January payroll ${created.status}: ${JSON.stringify(created.value)}`
			);
			requireAccepted(created.value, 'create January payroll');

			await session.query(
				`update payroll_runs set lifecycle = 'PAID' where company_id = $1 and period = $2`,
				[COMPANY_ID, JANUARY_2026]
			);

			const rosterId = await createEmptyRoster(session, JANUARY_2026);
			const payload = await rosterPayloadFromXlsx(rosterId, [
				['PUB-EMP-0001', '2026-01-15', 'OFF']
			]);
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
			assert.match(
				commandSentence(locked),
				/Importing roster on .* is refused: that day is inside paid payroll 2026-01/
			);
		} finally {
			await session.stop();
		}
	}
);

test('rosterImportPayload refuses a slashed work_date without opening an xlsx', () => {
	assert.throws(
		() =>
			rosterImportPayload(
				new Map([
					[
						'Roster',
						[
							['employee_number', 'work_date', 'shift_code'],
							['PUB-EMP-0001', '04/05/2026', 'OFF']
						]
					]
				]),
				'00000000-0000-4000-8000-000000000099'
			),
		(error: unknown) => {
			assert.ok(error instanceof WorkbookImportError, String(error));
			assert.match(error.message, /04\/05\/2026/);
			return true;
		}
	);
});
