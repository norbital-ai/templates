/**
 * The import round trip, on the workbooks that were sent to operators.
 *
 * A real .xlsx is written with the layout of the shipped import templates — the `Read me first`
 * sheet included, dates and clock times stored as text — then read back through the same conversion
 * the browser runs, and the resulting JSON is handed to the collection's own `+pipelines.ts`
 * handler. So this exercises the whole path the operator's click takes, minus the file dialog and
 * the transport.
 *
 * The roster sheet carries real roster-code tokens. A blank shift cell is an absent explicit
 * assignment, REST/OFF are real variants, and PH is validated against the observed calendar but
 * never persisted as a person-day fact.
 *
 * The time-entry sheet carries four columns, one row per person per day.
 *
 * The refusal cases matter as much as the happy one: the platform writes an import in a single
 * transaction and has no per-row rejection, so a bad row must refuse the WHOLE file and say which
 * row it was.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { Effect } from 'effect';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({
	root,
	appType: 'custom',
	logLevel: 'silent',
	server: { middlewareMode: true }
});

/** The workbook as the operator's browser sees it: written to bytes, then loaded back. */
async function gridsOf(sheets) {
	const workbook = new ExcelJS.Workbook();
	for (const [name, rows] of sheets) {
		const worksheet = workbook.addWorksheet(name);
		for (const row of rows) worksheet.addRow(row);
	}
	const reloaded = new ExcelJS.Workbook();
	await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());
	return reloaded;
}

/** The `Read me first` sheet every shipped template opens with, which the import must ignore. */
const README = [['Roster import — planned assignment'], [], ['One row per person per day.']];

const ROSTER_HEADERS = ['employee_number', 'work_date', 'shift_code'];
const ROSTER_ROWS = [
	['NHPMY0002', '2026-05-01', '7.5AM'],
	['NHPMY0002', '2026-05-02', '7.5AM'],
	['NHPMY0002', '2026-05-03', 'REST'],
	['NHPMY0002', '2026-05-04', '7.5AM'],
	['NHPMY0002', '2026-05-05', '7.5AM'],
	['NHPMY0023', '2026-05-04', 'AM0830'],
	['NHPMY0023', '2026-05-05', 'PM2030'],
	['NHPMY0023', '2026-05-06', 'OFF'],
	['NHPMY0023', '2026-05-07', ''],
	['NHPMY0023', '2026-05-08', 'PH']
];

const TIME_ENTRY_HEADERS = ['employee_number', 'work_date', 'clock_in', 'clock_out'];
const TIME_ENTRY_ROWS = [
	['NHPMY0002', '2026-05-04', '08:16', '17:10'],
	['NHPMY0002', '2026-05-05', '08:02', '17:05'],
	['NHPMY0023', '2026-05-04', '20:30', '05:15'],
	['NHPMY0023', '2026-05-05', '20:28', '05:02'],
	['NHPMY0023', '2026-05-06', '20:31', '']
];
const SETTINGS_ROWS = [
	['Setting', 'Value'],
	['timezone', 'Asia/Kuala_Lumpur'],
	[],
	['', 'An IANA timezone name.']
];

const ROSTER_ID = 'roster:2026-05';
const COMPANY_ID = 'company:1';

function matches(row, where = {}) {
	return Object.entries(where).every(([column, condition]) => {
		if (condition == null) return true;
		if ('eq' in condition) return String(row[column]) === String(condition.eq);
		if ('in' in condition) return condition.in.map(String).includes(String(row[column]));
		if ('isNull' in condition) return (row[column] == null) === condition.isNull;
		throw new Error(`The stub does not implement ${JSON.stringify(condition)} on ${column}.`);
	});
}

/** A stand-in for the workspace tables the pipelines resolve names against. */
function stubApi(tables) {
	const query = Object.fromEntries(
		Object.entries(tables).map(([name, rows]) => [
			name,
			{
				findFirst: ({ where } = {}) =>
					Effect.succeed(rows.find((row) => matches(row, where)) ?? null),
				findMany: ({ where } = {}) => Effect.succeed(rows.filter((row) => matches(row, where)))
			}
		])
	);
	return { db: { query } };
}

/** Resolve an authored handler result the way the runtime does: Effect, promise, or value. */
function runHandler(result) {
	if (Effect.isEffect(result)) return Effect.runPromise(result);
	if (result instanceof Promise) return result;
	return Effect.runPromise(Effect.succeed(result));
}

function companies() {
	return [
		{
			norbital_id: COMPANY_ID,
			name: 'Nihon Pigment Sdn. Bhd.',
			registration_number: '1234567-A'
		},
		{
			norbital_id: 'company:ph',
			name: 'Omni Plus System Philippines, Inc.',
			registration_number: 'SOURCE_NOT_PROVIDED'
		}
	];
}

function rosterApi(overrides = {}) {
	return stubApi({
		rosters: [
			{
				norbital_id: ROSTER_ID,
				month: '2026-05',
				published_at: null,
				company_id: COMPANY_ID,
				...overrides.roster
			}
		],
		companies: companies(),
		employments: [
			{ norbital_id: 'employment:2', employee_number: 'NHPMY0002', company_id: COMPANY_ID },
			{ norbital_id: 'employment:23', employee_number: 'NHPMY0023', company_id: COMPANY_ID }
		],
		shift_definitions: [
			{
				norbital_id: 'shift:75',
				code: '7.5AM',
				company_id: COMPANY_ID,
				variant: { kind: 'WORK', start_time: '08:30', end_time: '17:00', break_minutes: 60 },
				effective_range: { start: '2020-01-01' }
			},
			{
				norbital_id: 'shift:am',
				code: 'AM0830',
				company_id: COMPANY_ID,
				variant: { kind: 'WORK', start_time: '08:30', end_time: '17:30', break_minutes: 60 },
				effective_range: { start: '2020-01-01' }
			},
			{
				norbital_id: 'shift:pm',
				code: 'PM2030',
				company_id: COMPANY_ID,
				variant: { kind: 'WORK', start_time: '20:30', end_time: '05:30', break_minutes: 60 },
				effective_range: { start: '2020-01-01' }
			},
			{
				norbital_id: 'shift:rest',
				code: 'REST',
				company_id: COMPANY_ID,
				variant: { kind: 'REST' },
				effective_range: { start: '2020-01-01' }
			},
			{
				norbital_id: 'shift:off',
				code: 'OFF',
				company_id: COMPANY_ID,
				variant: { kind: 'OFF' },
				effective_range: { start: '2020-01-01' }
			}
		],
		company_holidays: [{ norbital_id: 'holiday:1', company_id: COMPANY_ID, date: '2026-05-08' }],
		roster_entries: overrides.existingEntries ?? []
	});
}

function timeEntryApi(overrides = {}) {
	return stubApi({
		companies: companies(),
		employments: [
			{ norbital_id: 'employment:2', employee_number: 'NHPMY0002', company_id: COMPANY_ID },
			{ norbital_id: 'employment:23', employee_number: 'NHPMY0023', company_id: COMPANY_ID }
		],
		time_entries: overrides.existingEntries ?? [],
		payroll_runs: overrides.payrollRuns ?? [],
		leave_requests: overrides.leaveRequests ?? []
	});
}

async function refusal(run) {
	try {
		// The callback is async (it builds the payload from grids), so resolve it first — the
		// handler result it returns is then resolved the way the runtime does.
		await runHandler(await run());
	} catch (error) {
		return error.message;
	}
	throw new assert.AssertionError({
		message: 'Expected the import to be refused, but it was not.'
	});
}

try {
	const { rosterImportPayload } = await vite.ssrLoadModule(
		'/src/collections/roster_entries/lib/import-workbook.ts'
	);
	const { timeEntryImportPayload } = await vite.ssrLoadModule(
		'/src/collections/time_entries/lib/import-workbook.ts'
	);
	const { workbookGrids, csvGrid } = await vite.ssrLoadModule('/src/lib/workbook-rows.ts');
	const rosterPipeline = (await vite.ssrLoadModule('/src/collections/roster_entries/+pipelines.ts'))
		.default;
	const timeEntryPipeline = (
		await vite.ssrLoadModule('/src/collections/time_entries/+pipelines.ts')
	).default;

	const rosterGrids = async (rows) =>
		workbookGrids(
			await gridsOf([
				['Read me first', README],
				['Roster', [ROSTER_HEADERS, ...rows]]
			])
		);
	const timeEntryGrids = async (rows, headers = TIME_ENTRY_HEADERS) =>
		workbookGrids(
			await gridsOf([
				['Read me first', README],
				['Settings', SETTINGS_ROWS],
				['Time entries', [headers, ...rows]]
			])
		);

	// ── The roster workbook, from bytes to written rows ────────────────────────────────────────────
	const rosterPayload = rosterImportPayload(await rosterGrids(ROSTER_ROWS), ROSTER_ID);
	assert.equal(rosterPayload.roster_id, ROSTER_ID);
	assert.equal(rosterPayload.rows.length, 9, 'blank assignment rows are omitted');
	assert.deepEqual(
		rosterPayload.rows[0],
		{
			employee_number: 'NHPMY0002',
			work_date: '2026-05-01',
			shift_code: '7.5AM',
			assignment_code: undefined,
			note: undefined
		},
		'a row naming a shift reads as a working day on that shift'
	);
	assert.deepEqual(
		rosterPayload.rows[2],
		{
			employee_number: 'NHPMY0002',
			work_date: '2026-05-03',
			shift_code: 'REST',
			assignment_code: undefined,
			note: undefined
		},
		'REST is a real roster-code variant'
	);

	const written = await runHandler(
		rosterPipeline.import.handler({ input: rosterPayload }, rosterApi())
	);
	assert.equal(written.length, 8, 'the validated PH token is not stored per person');
	assert.deepEqual(
		written.map((row) => row.shift_definition_id),
		[
			'shift:75',
			'shift:75',
			'shift:rest',
			'shift:75',
			'shift:75',
			'shift:am',
			'shift:pm',
			'shift:off'
		],
		'every persisted person-day references a real WORK/REST/OFF roster code'
	);
	assert.deepEqual(
		written.at(-1),
		{
			employment_id: 'employment:23',
			work_date: '2026-05-06',
			shift_definition_id: 'shift:off',
			roster_id: ROSTER_ID,
			assignment_code: null
		},
		'OFF remains explicit and its meaning comes from the referenced code variant'
	);

	// ── One bad row refuses the whole file, and says which row ─────────────────────────────────────
	const unknownEmployee = await refusal(async () =>
		rosterPipeline.import.handler(
			{
				input: rosterImportPayload(
					await rosterGrids([...ROSTER_ROWS, ['NHPMY9999', '2026-05-06', '7.5AM']]),
					ROSTER_ID
				)
			},
			rosterApi()
		)
	);
	assert.match(unknownEmployee, /not employed by this legal entity/);
	assert.match(unknownEmployee, /NHPMY9999/);
	assert.doesNotMatch(
		unknownEmployee,
		/NHPMY0002/,
		'only the offending number is named — the other rows are not at fault'
	);

	const outsideMonth = await refusal(async () =>
		rosterPipeline.import.handler(
			{
				input: rosterImportPayload(
					await rosterGrids([...ROSTER_ROWS, ['NHPMY0002', '2026-06-01', '7.5AM']]),
					ROSTER_ID
				)
			},
			rosterApi()
		)
	);
	assert.match(outsideMonth, /These rows do not belong to roster 2026-05/);
	assert.match(outsideMonth, /• NHPMY0002 on 2026-06-01/);

	const publishedMonth = await refusal(async () =>
		rosterPipeline.import.handler(
			{ input: rosterImportPayload(await rosterGrids(ROSTER_ROWS), ROSTER_ID) },
			rosterApi({ roster: { published_at: new Date('2026-04-20T00:00:00.000Z') } })
		)
	);
	assert.match(publishedMonth, /is published/);

	const alreadyPresent = await refusal(async () =>
		rosterPipeline.import.handler(
			{ input: rosterImportPayload(await rosterGrids(ROSTER_ROWS), ROSTER_ID) },
			rosterApi({
				existingEntries: [{ employment_id: 'employment:2', work_date: '2026-05-04' }]
			})
		)
	);
	assert.match(alreadyPresent, /already have an explicit assignment/);
	assert.match(alreadyPresent, /• NHPMY0002 on 2026-05-04/);

	// ── Cells the browser refuses before anything is sent ──────────────────────────────────────────
	const badCells = await refusal(async () =>
		rosterImportPayload(
			await rosterGrids([
				['NHPMY0002', '04/05/2026', '7.5AM'],
				['NHPMY0023', '', 'PM2030'],
				['', '2026-05-06', '']
			]),
			ROSTER_ID
		)
	);
	assert.match(badCells, /Nothing was written/);
	assert.match(badCells, /Row 2 \(NHPMY0002 on 04\/05\/2026\): work_date is "04\/05\/2026"/);
	assert.match(badCells, /Row 3 \(NHPMY0023\): work_date is empty/);
	assert.match(badCells, /Row 4 \(2026-05-06\): employee_number is empty/);
	assert.doesNotMatch(
		badCells,
		/shift_code/,
		'the third row leaves shift_code blank, which is an absent assignment — nothing to complain about'
	);

	const renamedColumns = workbookGrids(
		await gridsOf([
			[
				'Roster',
				[
					['employee_number', 'work_date'],
					['NHPMY0002', '2026-05-04']
				]
			]
		])
	);
	const missingColumn = await refusal(async () => rosterImportPayload(renamedColumns, ROSTER_ID));
	assert.match(missingColumn, /missing column the import needs/);
	assert.match(missingColumn, /No "shift_code" column/);

	const wrongSheet = await refusal(async () =>
		rosterImportPayload(
			workbookGrids(
				await gridsOf([
					['Read me first', README],
					['Sheet1', [ROSTER_HEADERS, ...ROSTER_ROWS]]
				])
			),
			ROSTER_ID
		)
	);
	assert.match(wrongSheet, /has no "Roster" sheet/);
	assert.match(wrongSheet, /"Read me first", "Sheet1"/);

	// ── A CSV is one sheet under any name ──────────────────────────────────────────────────────────
	const csvPayload = rosterImportPayload(
		new Map([
			[
				'roster.csv',
				csvGrid(
					`${ROSTER_HEADERS.join(',')}\n` +
						'NHPMY0002,2026-05-04,7.5AM\n' +
						'NHPMY0002,2026-05-05,\n'
				)
			]
		]),
		ROSTER_ID
	);
	assert.deepEqual(csvPayload.rows, [
		{
			employee_number: 'NHPMY0002',
			work_date: '2026-05-04',
			shift_code: '7.5AM',
			assignment_code: undefined,
			note: undefined
		}
	]);

	// ── The time-entry workbook ────────────────────────────────────────────────────────────────────
	const timePayload = timeEntryImportPayload(await timeEntryGrids(TIME_ENTRY_ROWS));
	assert.equal(
		timePayload.timezone,
		'Asia/Kuala_Lumpur',
		'the zone comes from the Settings sheet, never from the browser'
	);
	assert.equal(timePayload.rows.length, 5);
	assert.deepEqual(
		timePayload.rows[1],
		{
			employee_number: 'NHPMY0002',
			work_date: '2026-05-05',
			clock_in: '08:02',
			clock_out: '17:05',
			break_minutes: undefined
		},
		'a four-column row reads as punches alone — everything else the pipeline derives'
	);
	assert.equal(timePayload.rows[4].clock_out, undefined, 'an unclosed punch stays unclosed');

	const landed = await runHandler(
		timeEntryPipeline.import.handler({ input: timePayload }, timeEntryApi())
	);
	assert.equal(landed.length, 5);
	assert.deepEqual(
		landed[0],
		{
			employment_id: 'employment:2',
			work_date: '2026-05-04',
			worked_intervals: [
				{ start_at: '2026-05-04T00:16:00.000Z', end_at: '2026-05-04T09:10:00.000Z' }
			],
			break_minutes: 0
		},
		'both clocks present close the entry, and a break nobody wrote lands as none'
	);
	assert.deepEqual(
		landed[2],
		{
			employment_id: 'employment:23',
			work_date: '2026-05-04',
			worked_intervals: [
				{ start_at: '2026-05-04T12:30:00.000Z', end_at: '2026-05-04T21:15:00.000Z' }
			],
			break_minutes: 0
		},
		'a night shift closes on the next calendar day, eight hours behind UTC'
	);
	assert.equal(
		landed[4].worked_intervals[0].end_at,
		null,
		'a missing close remains an open interval'
	);

	const unknownPuncher = await refusal(async () =>
		timeEntryPipeline.import.handler(
			{
				input: timeEntryImportPayload(
					await timeEntryGrids([...TIME_ENTRY_ROWS, ['NHPMY9999', '2026-05-04', '08:00', '17:00']])
				)
			},
			timeEntryApi()
		)
	);
	assert.match(unknownPuncher, /not on file/);
	assert.match(unknownPuncher, /• NHPMY9999/);

	const noTimezone = await refusal(async () =>
		timeEntryImportPayload(
			workbookGrids(await gridsOf([['Time entries', [TIME_ENTRY_HEADERS, ...TIME_ENTRY_ROWS]]]))
		)
	);
	assert.match(noTimezone, /does not say which timezone/);

	const badClock = await refusal(async () =>
		timeEntryImportPayload(
			await timeEntryGrids([
				['NHPMY0002', '2026-05-04', '8.30am', '17:00'],
				['NHPMY0023', '05/05/2026', '20:30', '05:15']
			])
		)
	);
	assert.match(badClock, /clock_in is "8\.30am", expected a local time as HH:mm/);
	assert.match(badClock, /work_date is "05\/05\/2026", expected a date as YYYY-MM-DD/);

	// ── The issued month-grid templates (one entity × one month) ──────────────────────────────────
	const MAY_DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1));
	const gridRow = (employee, assignments) => {
		const cells = Array.from({ length: 31 }, () => '');
		for (const [day, value] of Object.entries(assignments)) cells[Number(day) - 1] = value;
		return [employee, ...cells];
	};
	const ROSTER_GRID_SETTINGS = [
		['Setting', 'Value'],
		['legal_entity', 'Nihon Pigment Sdn. Bhd.'],
		['month', '2026-05']
	];
	const TIME_GRID_SETTINGS = [
		['Setting', 'Value'],
		['legal_entity', 'Nihon Pigment Sdn. Bhd.'],
		['month', '2026-05'],
		['timezone', 'Asia/Kuala_Lumpur']
	];

	const rosterGridPayload = rosterImportPayload(
		workbookGrids(
			await gridsOf([
				['Read me first', [['Roster import — one legal entity, one month']]],
				['Settings', ROSTER_GRID_SETTINGS],
				[
					'Roster',
					[
						['employee_number', ...MAY_DAYS],
						gridRow('NHPMY0002', { 1: '7.5AM', 2: '7.5AM', 3: 'REST', 4: '7.5AM', 5: '7.5AM' }),
						gridRow('NHPMY0023', { 4: 'AM0830', 5: 'PM2030', 6: 'OFF' })
					]
				]
			])
		),
		ROSTER_ID
	);
	assert.equal(rosterGridPayload.legal_entity, 'Nihon Pigment Sdn. Bhd.');
	assert.equal(rosterGridPayload.month, '2026-05');
	assert.equal(rosterGridPayload.rows.length, 8);
	assert.deepEqual(
		rosterGridPayload.rows.map(
			(row) => `${row.employee_number} ${row.work_date} ${row.shift_code}`
		),
		[
			'NHPMY0002 2026-05-01 7.5AM',
			'NHPMY0002 2026-05-02 7.5AM',
			'NHPMY0002 2026-05-03 REST',
			'NHPMY0002 2026-05-04 7.5AM',
			'NHPMY0002 2026-05-05 7.5AM',
			'NHPMY0023 2026-05-04 AM0830',
			'NHPMY0023 2026-05-05 PM2030',
			'NHPMY0023 2026-05-06 OFF'
		]
	);
	const rosterGridWritten = await runHandler(
		rosterPipeline.import.handler({ input: rosterGridPayload }, rosterApi())
	);
	assert.equal(rosterGridWritten.length, 8);

	const timeGridPayload = timeEntryImportPayload(
		workbookGrids(
			await gridsOf([
				['Read me first', [['Time entries import — one legal entity, one month']]],
				['Settings', TIME_GRID_SETTINGS],
				[
					'Time entries',
					[
						['employee_number', ...MAY_DAYS],
						gridRow('NHPMY0002', { 4: '08:16-17:10', 5: '08:02-17:05' }),
						gridRow('NHPMY0023', { 4: '20:30-05:15', 5: '20:28-05:02', 6: '20:31' })
					]
				]
			])
		)
	);
	assert.equal(timeGridPayload.legal_entity, 'Nihon Pigment Sdn. Bhd.');
	assert.equal(timeGridPayload.month, '2026-05');
	assert.equal(timeGridPayload.rows.length, 5);
	assert.deepEqual(timeGridPayload.rows[4], {
		employee_number: 'NHPMY0023',
		work_date: '2026-05-06',
		clock_in: '20:31'
	});
	const timeGridWritten = await runHandler(
		timeEntryPipeline.import.handler({ input: timeGridPayload }, timeEntryApi())
	);
	assert.equal(timeGridWritten.length, 5);
	assert.equal(timeGridWritten[4].worked_intervals[0].end_at, null);

	const wrongEntity = await refusal(async () =>
		rosterPipeline.import.handler(
			{
				input: {
					...rosterGridPayload,
					legal_entity: 'Omni Plus System Philippines, Inc.'
				}
			},
			rosterApi()
		)
	);
	assert.match(wrongEntity, /not the legal entity/);

	console.log('workbook import: roster and time-entry templates round trip, and refuse by row.');
} finally {
	await vite.close();
}
