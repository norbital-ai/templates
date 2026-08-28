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
 * Both sheets now land in ONE collection through ONE pipeline: `work_days` has a single `import`,
 * and the payload's `sheet` tag decides which arm reads it. So the upsert is exercised here too —
 * a punch imported onto a day the roster import already wrote is an UPDATE of that row. The
 * pipeline returns both creates and updates; the stored id is the update assertion the runtime
 * sends through the same canonical mutation path as every other imported row.
 *
 * The refusal cases matter as much as the happy one: the platform writes an import in a single
 * transaction and has no per-row rejection, so a bad row must refuse the WHOLE file and say which
 * row it was.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { Cause, Effect } from 'effect';
import { createServer } from 'vite';
import { stubApi as tableStub } from './lib/stub-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function asError(cause) {
	return cause instanceof Error ? cause : new Error(String(cause));
}

function tryPromise(evaluate) {
	return Effect.tryPromise({ try: evaluate, catch: asError });
}

function tryMap(effect, transform) {
	return effect.pipe(
		Effect.flatMap((value) => Effect.try({ try: () => transform(value), catch: asError }))
	);
}

/** The workbook as the operator's browser sees it: written to bytes, then loaded back. */
function gridsOf(sheets) {
	return Effect.gen(function* () {
		const workbook = new ExcelJS.Workbook();
		for (const [name, rows] of sheets) {
			const worksheet = workbook.addWorksheet(name);
			for (const row of rows) worksheet.addRow(row);
		}
		const reloaded = new ExcelJS.Workbook();
		const buffer = yield* tryPromise(() => workbook.xlsx.writeBuffer());
		yield* tryPromise(() => reloaded.xlsx.load(buffer));
		return reloaded;
	});
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

/** The instant the published-roster refusal is checked against; a fixture value, not a clock. */
const PUBLISHED_AT = new Date('2026-04-20T00:00:00.000Z');
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
const stubApi = (tables) => tableStub(tables, matches);

/** Resolve an authored handler result the way the runtime does: Effect, promise, or value. */
function runHandler(result) {
	if (Effect.isEffect(result)) return result;
	if (result instanceof Promise) return tryPromise(() => result);
	return Effect.succeed(result);
}

function runHandlerCall(run) {
	return Effect.try({ try: run, catch: asError }).pipe(Effect.flatMap(runHandler));
}

function companies() {
	return [
		{
			id: COMPANY_ID,
			name: 'Nihon Pigment Sdn. Bhd.',
			registration_number: '1234567-A'
		},
		{
			id: 'company:ph',
			name: 'Omni Plus System Philippines, Inc.',
			registration_number: 'SOURCE_NOT_PROVIDED'
		}
	];
}

function rosterApi(overrides = {}) {
	return stubApi({
		rosters: [
			{
				id: ROSTER_ID,
				month: '2026-05',
				published_at: null,
				company_id: COMPANY_ID,
				...overrides.roster
			}
		],
		companies: companies(),
		employments: [
			{ id: 'employment:2', employee_number: 'NHPMY0002', company_id: COMPANY_ID },
			{ id: 'employment:23', employee_number: 'NHPMY0023', company_id: COMPANY_ID }
		],
		shift_definitions: [
			{
				id: 'shift:75',
				code: '7.5AM',
				company_id: COMPANY_ID,
				variant: { kind: 'WORK', start_time: '08:30', end_time: '17:00', break_minutes: 60 },
				effective_range: { start: '2020-01-01', end: null }
			},
			{
				id: 'shift:am',
				code: 'AM0830',
				company_id: COMPANY_ID,
				variant: { kind: 'WORK', start_time: '08:30', end_time: '17:30', break_minutes: 60 },
				effective_range: { start: '2020-01-01', end: null }
			},
			{
				id: 'shift:pm',
				code: 'PM2030',
				company_id: COMPANY_ID,
				variant: { kind: 'WORK', start_time: '20:30', end_time: '05:30', break_minutes: 60 },
				effective_range: { start: '2020-01-01', end: null }
			},
			{
				id: 'shift:rest',
				code: 'REST',
				company_id: COMPANY_ID,
				variant: { kind: 'REST' },
				effective_range: { start: '2020-01-01', end: null }
			},
			{
				id: 'shift:off',
				code: 'OFF',
				company_id: COMPANY_ID,
				variant: { kind: 'OFF' },
				effective_range: { start: '2020-01-01', end: null }
			}
		],
		company_holidays: [{ id: 'holiday:1', company_id: COMPANY_ID, date: '2026-05-08' }],
		work_days: overrides.existingDays ?? []
	});
}

function attendanceApi(overrides = {}) {
	return stubApi({
		companies: companies(),
		employments: [
			{ id: 'employment:2', employee_number: 'NHPMY0002', company_id: COMPANY_ID },
			{ id: 'employment:23', employee_number: 'NHPMY0023', company_id: COMPANY_ID }
		],
		work_days: overrides.existingDays ?? [],
		payroll_runs: overrides.payrollRuns ?? [],
		leave_requests: overrides.leaveRequests ?? []
	});
}

function refusal(run) {
	return runHandlerCall(run).pipe(
		Effect.matchCauseEffect({
			onFailure: (cause) => Effect.succeed(asError(Cause.squash(cause)).message),
			onSuccess: () =>
				Effect.fail(
					new assert.AssertionError({
						message: 'Expected the import to be refused, but it was not.'
					})
				)
		})
	);
}

const program = Effect.gen(function* () {
	const vite = yield* tryPromise(() =>
		createServer({
			root,
			appType: 'custom',
			logLevel: 'silent',
			server: { middlewareMode: true }
		})
	);

	const verification = Effect.gen(function* () {
		const { attendanceImportPayload, rosterImportPayload } = yield* tryPromise(() =>
			vite.ssrLoadModule('/src/collections/work_days/lib/import-workbook.ts')
		);
		const { workbookGrids, csvGrid } = yield* tryPromise(() =>
			vite.ssrLoadModule('/src/lib/workbook-rows.ts')
		);
		const workDayPipeline = (yield* tryPromise(() =>
			vite.ssrLoadModule('/src/collections/work_days/+pipelines.ts')
		)).default;

		const rosterGrids = (rows) =>
			gridsOf([
				['Read me first', README],
				['Roster', [ROSTER_HEADERS, ...rows]]
			]).pipe(Effect.map(workbookGrids));
		const timeEntryGrids = (rows, headers = TIME_ENTRY_HEADERS) =>
			gridsOf([
				['Read me first', README],
				['Settings', SETTINGS_ROWS],
				['Time entries', [headers, ...rows]]
			]).pipe(Effect.map(workbookGrids));

		// ── The roster workbook, from bytes to written rows ────────────────────────────────────────────
		const rosterPayload = rosterImportPayload(yield* rosterGrids(ROSTER_ROWS), ROSTER_ID);
		assert.equal(
			rosterPayload.sheet,
			'ROSTER',
			'the arm is tagged, not inferred from which fields are set'
		);
		assert.equal(rosterPayload.roster_id, ROSTER_ID);
		assert.equal(rosterPayload.rows.length, 9, 'blank assignment rows are omitted');
		assert.deepEqual(
			rosterPayload.rows[0],
			{
				employee_number: 'NHPMY0002',
				work_date: '2026-05-01',
				shift_code: '7.5AM',
				assignment_code: undefined,
				planned_note: undefined
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
				planned_note: undefined
			},
			'REST is a real roster-code variant'
		);

		const written = yield* runHandler(
			workDayPipeline.import.handler({ input: rosterPayload }, rosterApi())
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
				assignment_code: null,
				planned_origin: 'IMPORT',
				planned_note: null
			},
			'OFF remains explicit and its meaning comes from the referenced code variant'
		);
		assert.ok(
			written.every((row) => row.planned_origin === 'IMPORT'),
			'a workbook row is IMPORT provenance, not the MANUAL the board writes'
		);
		assert.ok(
			written.every((row) => !('worked_intervals' in row) && !('break_minutes' in row)),
			'the roster arm writes the plan and never touches the clock'
		);

		// ── Every column the long-form sheet declares reaches the row that is written ──────────────────
		const annotatedWorkbook = yield* gridsOf([
			[
				'Roster',
				[
					[...ROSTER_HEADERS, 'assignment_code', 'note'],
					['NHPMY0002', '2026-05-04', '7.5AM', 'AMRES', 'swap with 03 May']
				]
			]
		]);
		const annotated = yield* runHandler(
			workDayPipeline.import.handler(
				{
					input: rosterImportPayload(workbookGrids(annotatedWorkbook), ROSTER_ID)
				},
				rosterApi()
			)
		);
		assert.deepEqual(annotated, [
			{
				employment_id: 'employment:2',
				work_date: '2026-05-04',
				shift_definition_id: 'shift:75',
				roster_id: ROSTER_ID,
				assignment_code: 'AMRES',
				planned_origin: 'IMPORT',
				planned_note: 'swap with 03 May'
			}
		]);

		// ── One bad row refuses the whole file, and says which row ─────────────────────────────────────
		const unknownEmployee = yield* refusal(() =>
			Effect.gen(function* () {
				const grids = yield* rosterGrids([...ROSTER_ROWS, ['NHPMY9999', '2026-05-06', '7.5AM']]);
				return yield* runHandlerCall(() =>
					workDayPipeline.import.handler(
						{ input: rosterImportPayload(grids, ROSTER_ID) },
						rosterApi()
					)
				);
			})
		);
		assert.match(unknownEmployee, /not employed by this legal entity/);
		assert.match(unknownEmployee, /NHPMY9999/);
		assert.doesNotMatch(
			unknownEmployee,
			/NHPMY0002/,
			'only the offending number is named — the other rows are not at fault'
		);

		const outsideMonth = yield* refusal(() =>
			Effect.gen(function* () {
				const grids = yield* rosterGrids([...ROSTER_ROWS, ['NHPMY0002', '2026-06-01', '7.5AM']]);
				return yield* runHandlerCall(() =>
					workDayPipeline.import.handler(
						{ input: rosterImportPayload(grids, ROSTER_ID) },
						rosterApi()
					)
				);
			})
		);
		assert.match(outsideMonth, /These rows do not belong to roster 2026-05/);
		assert.match(outsideMonth, /• NHPMY0002 on 2026-06-01/);

		const publishedMonth = yield* refusal(() =>
			Effect.gen(function* () {
				const grids = yield* rosterGrids(ROSTER_ROWS);
				return yield* runHandlerCall(() =>
					workDayPipeline.import.handler(
						{ input: rosterImportPayload(grids, ROSTER_ID) },
						rosterApi({ roster: { published_at: PUBLISHED_AT } })
					)
				);
			})
		);
		assert.match(publishedMonth, /is published/);

		const alreadyPresent = yield* refusal(() =>
			Effect.gen(function* () {
				const grids = yield* rosterGrids(ROSTER_ROWS);
				return yield* runHandlerCall(() =>
					workDayPipeline.import.handler(
						{ input: rosterImportPayload(grids, ROSTER_ID) },
						rosterApi({
							existingDays: [
								{
									id: 'day:1',
									employment_id: 'employment:2',
									work_date: '2026-05-04',
									shift_definition_id: 'shift:75',
									worked_intervals: null
								}
							]
						})
					)
				);
			})
		);
		assert.match(alreadyPresent, /already have an explicit assignment/);
		assert.match(alreadyPresent, /• NHPMY0002 on 2026-05-04/);

		// ── Cells the browser refuses before anything is sent ──────────────────────────────────────────
		const badCells = yield* refusal(() =>
			tryMap(
				rosterGrids([
					['NHPMY0002', '04/05/2026', '7.5AM'],
					['NHPMY0023', '', 'PM2030'],
					['', '2026-05-06', '']
				]),
				(grids) => rosterImportPayload(grids, ROSTER_ID)
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
			yield* gridsOf([
				[
					'Roster',
					[
						['employee_number', 'work_date'],
						['NHPMY0002', '2026-05-04']
					]
				]
			])
		);
		const missingColumn = yield* refusal(() => rosterImportPayload(renamedColumns, ROSTER_ID));
		assert.match(missingColumn, /missing column the import needs/);
		assert.match(missingColumn, /No "shift_code" column/);

		const wrongSheet = yield* refusal(() =>
			tryMap(
				gridsOf([
					['Read me first', README],
					['Sheet1', [ROSTER_HEADERS, ...ROSTER_ROWS]]
				]),
				(workbook) => rosterImportPayload(workbookGrids(workbook), ROSTER_ID)
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
				planned_note: undefined
			}
		]);

		// ── The time-entry workbook ────────────────────────────────────────────────────────────────────
		const timePayload = attendanceImportPayload(yield* timeEntryGrids(TIME_ENTRY_ROWS));
		assert.equal(timePayload.sheet, 'ATTENDANCE');
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

		const landed = yield* runHandler(
			workDayPipeline.import.handler({ input: timePayload }, attendanceApi())
		);
		assert.equal(landed.length, 5);
		assert.deepEqual(
			landed[0],
			{
				employment_id: 'employment:2',
				work_date: '2026-05-04',
				worked_intervals: [{ start: '2026-05-04T00:16:00.000Z', end: '2026-05-04T09:10:00.000Z' }],
				break_minutes: 0
			},
			'both clocks present close the entry, and a break nobody wrote lands as none'
		);
		assert.deepEqual(
			landed[2],
			{
				employment_id: 'employment:23',
				work_date: '2026-05-04',
				worked_intervals: [{ start: '2026-05-04T12:30:00.000Z', end: '2026-05-04T21:15:00.000Z' }],
				break_minutes: 0
			},
			'a night shift closes on the next calendar day, eight hours behind UTC'
		);
		assert.equal(
			landed[4].worked_intervals[0].end,
			null,
			'a missing close remains an open interval'
		);

		// ── THE UPSERT: a punch on a rostered day updates that day, it does not make a second one ──
		//
		// This is the whole point of the merge. `unique(employment_id, work_date)` means a person-day
		// is one row, so attendance landing on a day the roster import already wrote is an UPDATE row
		// carrying the stored id. New rows omit id; both remain in one ordered mutation batch.
		const rosteredDays = [
			{
				id: 'day:2-05-04',
				employment_id: 'employment:2',
				work_date: '2026-05-04',
				shift_definition_id: 'shift:75',
				worked_intervals: null
			},
			{
				id: 'day:2-05-05',
				employment_id: 'employment:2',
				work_date: '2026-05-05',
				shift_definition_id: 'shift:75',
				worked_intervals: null
			}
		];
		const onRostered = yield* runHandler(
			workDayPipeline.import.handler(
				{ input: timePayload },
				attendanceApi({ existingDays: rosteredDays })
			)
		);
		assert.equal(
			onRostered.length,
			5,
			'the import returns its complete ordered create/update mutation batch'
		);
		assert.deepEqual(
			onRostered.filter((values) => values.id != null).map((values) => values.id),
			['day:2-05-04', 'day:2-05-05'],
			'the two rostered days assert their stored ids rather than creating duplicates'
		);
		assert.deepEqual(
			onRostered[0],
			{
				id: 'day:2-05-04',
				employment_id: 'employment:2',
				work_date: '2026-05-04',
				worked_intervals: [{ start: '2026-05-04T00:16:00.000Z', end: '2026-05-04T09:10:00.000Z' }],
				break_minutes: 0
			},
			'the attendance arm writes the clock and never touches the plan it landed on'
		);

		const alreadyAttended = yield* refusal(() =>
			runHandlerCall(() =>
				workDayPipeline.import.handler(
					{ input: timePayload },
					attendanceApi({
						existingDays: [
							{
								id: 'day:2-05-04',
								employment_id: 'employment:2',
								work_date: '2026-05-04',
								shift_definition_id: null,
								worked_intervals: []
							}
						]
					})
				)
			)
		);
		// An empty array is attendance: the day was read and nothing was worked. NULL is the absence
		// this import is allowed to fill in, and the two are deliberately different claims.
		assert.match(alreadyAttended, /already have attendance/);
		assert.match(alreadyAttended, /• NHPMY0002 on 2026-05-04/);

		const rosterOntoAttendance = yield* runHandler(
			workDayPipeline.import.handler(
				{ input: rosterPayload },
				rosterApi({
					existingDays: [
						{
							id: 'day:attendance-first',
							employment_id: 'employment:2',
							work_date: '2026-05-01',
							shift_definition_id: null,
							worked_intervals: [
								{ start: '2026-05-01T00:16:00.000Z', end: '2026-05-01T09:10:00.000Z' }
							]
						}
					]
				})
			)
		);
		assert.equal(
			rosterOntoAttendance.length,
			8,
			'a day that exists only because attendance arrived first is not a roster conflict — the ' +
				'plan lands on it as one id-bearing update beside seven creates'
		);
		assert.equal(rosterOntoAttendance[0].id, 'day:attendance-first');

		const unknownPuncher = yield* refusal(() =>
			Effect.gen(function* () {
				const grids = yield* timeEntryGrids([
					...TIME_ENTRY_ROWS,
					['NHPMY9999', '2026-05-04', '08:00', '17:00']
				]);
				return yield* runHandlerCall(() =>
					workDayPipeline.import.handler({ input: attendanceImportPayload(grids) }, attendanceApi())
				);
			})
		);
		assert.match(unknownPuncher, /not on file/);
		assert.match(unknownPuncher, /• NHPMY9999/);

		const noTimezone = yield* refusal(() =>
			tryMap(gridsOf([['Time entries', [TIME_ENTRY_HEADERS, ...TIME_ENTRY_ROWS]]]), (workbook) =>
				attendanceImportPayload(workbookGrids(workbook))
			)
		);
		assert.match(noTimezone, /does not say which timezone/);

		const badClock = yield* refusal(() =>
			tryMap(
				timeEntryGrids([
					['NHPMY0002', '2026-05-04', '8.30am', '17:00'],
					['NHPMY0023', '05/05/2026', '20:30', '05:15']
				]),
				attendanceImportPayload
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
				yield* gridsOf([
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
		const rosterGridWritten = yield* runHandler(
			workDayPipeline.import.handler({ input: rosterGridPayload }, rosterApi())
		);
		assert.equal(rosterGridWritten.length, 8);

		const timeGridPayload = attendanceImportPayload(
			workbookGrids(
				yield* gridsOf([
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
		const timeGridWritten = yield* runHandler(
			workDayPipeline.import.handler({ input: timeGridPayload }, attendanceApi())
		);
		assert.equal(timeGridWritten.length, 5);
		assert.equal(timeGridWritten[4].worked_intervals[0].end, null);

		const wrongEntity = yield* refusal(() =>
			runHandlerCall(() =>
				workDayPipeline.import.handler(
					{
						input: {
							...rosterGridPayload,
							legal_entity: 'Omni Plus System Philippines, Inc.'
						}
					},
					rosterApi()
				)
			)
		);
		assert.match(wrongEntity, /not the legal entity/);

		console.log('workbook import: roster and time-entry templates round trip, and refuse by row.');
	});

	return yield* verification.pipe(Effect.ensuring(tryPromise(() => vite.close())));
});

// repository-health:allow EFF3 -- Node ESM requires one top-level await to propagate the Effect program's exit status.
await Effect.runPromise(program);
