/**
 * The import round trip, on the workbook that is sent to operators.
 *
 * A real .xlsx is written with the layout of the shipped scheduling template — the `Read me first`
 * sheet included, dates and clock times stored as text — then read back through the same
 * conversion the browser runs (`schedulingImportPayload`), and the resulting JSON is handed to the
 * collection's own `+pipelines.ts` handler. So this exercises the whole path the operator's click
 * takes, minus the file dialog and the transport.
 *
 * One workbook, one legal entity, one calendar month, as a set: the Roster sheet is the roster of
 * record (whole, or refused naming the gaps), the Time entries sheet is the attendance. A sealed
 * day may be restated unchanged; changed or omitted it refuses the file by name.
 *
 * The refusal cases matter as much as the happy one: the platform writes an import in a single
 * transaction and has no per-row rejection, so a bad row must refuse the WHOLE file and say which
 * row it was.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toError } from '@norbital-ai/std';
import ExcelJS from 'exceljs';
import { Cause, Effect } from 'effect';
import { createServer } from 'vite';
import { stubApi as tableStub } from './lib/stub-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = mkdtempSync(path.join(os.tmpdir(), 'hr-payroll-workbook-import-'));
const VALID_ROSTER_FIXTURE = path.join(FIXTURES_DIR, 'roster-import-valid.xlsx');
const INVALID_ROSTER_FIXTURE = path.join(FIXTURES_DIR, 'roster-import-invalid.xlsx');

function tryPromise(evaluate) {
	return Effect.tryPromise({ try: evaluate, catch: toError });
}

function tryMap(effect, transform) {
	return effect.pipe(
		Effect.flatMap((value) => Effect.try({ try: () => transform(value), catch: toError }))
	);
}

function fillWorkbook(sheets) {
	const workbook = new ExcelJS.Workbook();
	for (const [name, rows] of sheets) {
		const worksheet = workbook.addWorksheet(name);
		for (const row of rows) worksheet.addRow(row);
	}
	return workbook;
}

/** The workbook as the operator's browser sees it: written to bytes, then loaded back. */
function gridsOf(sheets) {
	return Effect.gen(function* () {
		const workbook = fillWorkbook(sheets);
		const reloaded = new ExcelJS.Workbook();
		const buffer = yield* tryPromise(() => workbook.xlsx.writeBuffer());
		yield* tryPromise(() => reloaded.xlsx.load(buffer));
		return reloaded;
	});
}

function writeWorkbookFile(filePath, sheets) {
	return Effect.gen(function* () {
		mkdirSync(path.dirname(filePath), { recursive: true });
		const workbook = fillWorkbook(sheets);
		yield* tryPromise(() => workbook.xlsx.writeFile(filePath));
		return filePath;
	});
}

function workbookFromFile(filePath) {
	return Effect.gen(function* () {
		const workbook = new ExcelJS.Workbook();
		yield* tryPromise(() => workbook.xlsx.readFile(filePath));
		return workbook;
	});
}

/** The `Read me first` sheet every shipped template opens with, which the import must ignore. */
const README = [['Scheduling import — one legal entity, one month'], [], ['Two sheets.']];
const MONTH = '2026-05';
const MAY_DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1));
const SETTINGS = [
	['Setting', 'Value'],
	['legal_entity', 'Public Fixture Co'],
	['month', MONTH],
	['timezone', 'Asia/Kuala_Lumpur'],
	[],
	['', 'An IANA timezone name.']
];
const SETTINGS_NO_TIMEZONE = SETTINGS.slice(0, 3);
const ROSTER_HEADERS = ['employee_number', 'work_date', 'shift_code'];
const TIME_ENTRY_HEADERS = ['employee_number', 'work_date', 'clock_in', 'clock_out'];
const COMPANY_ID = 'company:1';

/** A whole month for one person: weekdays on `code`, Saturday REST, Sunday OFF. */
function wholeMonth(employee, code, overrides = {}) {
	return MAY_DAYS.map((day) => {
		const date = `${MONTH}-${day.padStart(2, '0')}`;
		const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
		const shift = overrides[date] ?? (weekday === 6 ? 'REST' : weekday === 0 ? 'OFF' : code);
		return [employee, date, shift];
	});
}
const ROSTER_ROWS = [...wholeMonth('PUBEM0002', '7.5AM'), ...wholeMonth('PUBEM0023', 'AM0830')];
const TIME_ENTRY_ROWS = [
	['PUBEM0002', '2026-05-04', '08:16', '17:10'],
	['PUBEM0002', '2026-05-05', '08:02', '17:05'],
	['PUBEM0023', '2026-05-04', '20:30', '05:15'],
	['PUBEM0023', '2026-05-05', '20:28', '05:02'],
	['PUBEM0023', '2026-05-06', '20:31', '']
];

function matches(row, where = {}) {
	return Object.entries(where).every(([column, condition]) => {
		if (condition == null) return true;
		if ('eq' in condition) return String(row[column]) === String(condition.eq);
		if ('in' in condition) return condition.in.map(String).includes(String(row[column]));
		if ('isNull' in condition) return (row[column] == null) === condition.isNull;
		if ('gte' in condition || 'lte' in condition || 'lt' in condition)
			return (
				(!('gte' in condition) || String(row[column]) >= String(condition.gte)) &&
				(!('lte' in condition) || String(row[column]) <= String(condition.lte)) &&
				(!('lt' in condition) || String(row[column]) < String(condition.lt))
			);
		if ('isNotNull' in condition)
			return condition.isNotNull ? row[column] != null : row[column] == null;
		if ('isNull' in condition) return condition.isNull ? row[column] == null : row[column] != null;
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
	return Effect.try({ try: run, catch: toError }).pipe(Effect.flatMap(runHandler));
}

function companies() {
	return [
		{
			id: COMPANY_ID,
			name: 'Public Fixture Co',
			registration_number: '1234567-A',
			settings_code: 'TEST',
			pay_frequency: 'MONTHLY',
			pay_cutoff_day: 1
		},
		{
			id: 'company:ph',
			name: 'Public Fixture PH',
			registration_number: 'SOURCE_NOT_PROVIDED',
			settings_code: 'TEST'
		}
	];
}

function employments() {
	return ['2', '23'].map((id) => ({
		id: `employment:${id}`,
		employee_id: `employee:${id}`,
		employee_number: `PUBEM${id.padStart(4, '0')}`,
		company_id: COMPANY_ID,
		effective_range: { start: '2020-01-01', end: null },
		approval_id: null
	}));
}

const shift = (id, code, variant) => ({
	id,
	code,
	company_id: COMPANY_ID,
	variant,
	effective_range: { start: '2020-01-01', end: null }
});

function api(overrides = {}) {
	return stubApi({
		companies: companies(),
		employments: employments(),
		shift_definitions: [
			shift('shift:75', '7.5AM', {
				kind: 'WORK',
				start_time: '08:30',
				end_time: '17:00',
				break_minutes: 60
			}),
			shift('shift:am', 'AM0830', {
				kind: 'WORK',
				start_time: '08:30',
				end_time: '17:30',
				break_minutes: 60
			}),
			shift('shift:pm', 'PM2030', {
				kind: 'WORK',
				start_time: '20:30',
				end_time: '05:30',
				break_minutes: 60
			}),
			shift('shift:rest', 'REST', { kind: 'REST' }),
			shift('shift:off', 'OFF', { kind: 'OFF' })
		],
		work_days: overrides.existingDays ?? [],
		rosters: overrides.rosters ?? [],
		leave_entries: overrides.leaveEntries ?? []
	});
}

function refusal(run) {
	return runHandlerCall(run).pipe(
		Effect.matchCauseEffect({
			onFailure: (cause) => Effect.succeed(toError(Cause.squash(cause)).message),
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
		const { schedulingImportPayload } = yield* tryPromise(() =>
			vite.ssrLoadModule('/src/collections/work_days/lib/import-workbook.ts')
		);
		const { workbookGrids } = yield* tryPromise(() =>
			vite.ssrLoadModule('/src/lib/workbook-rows.ts')
		);
		const workDayPipeline = (yield* tryPromise(() =>
			vite.ssrLoadModule('/src/collections/work_days/+pipelines.ts')
		)).default;

		/** The workbook as bytes, then as the browser's payload. */
		const payloadOf = (sheets) =>
			gridsOf(sheets).pipe(Effect.map((wb) => schedulingImportPayload(workbookGrids(wb))));
		const workbook = (roster, attendance, settings = SETTINGS) => [
			['Read me first', README],
			['Settings', settings],
			...(roster === undefined ? [] : [['Roster', [ROSTER_HEADERS, ...roster]]]),
			...(attendance === undefined ? [] : [['Time entries', [TIME_ENTRY_HEADERS, ...attendance]]])
		];
		// The handler returns the days it creates and updates the restated ones through the
		// collection; the checks below read both as the rows the import wrote.
		const imported = (payload, stub = api()) =>
			runHandler(workDayPipeline.import.handler({ input: payload }, stub)).pipe(
				Effect.map((rows) => ({ rows: [...rows, ...(stub.mutated.work_days ?? [])], stub }))
			);
		/** The workbook straight through to the handler, as one effect a refusal can catch. */
		const importOf = (sheets, stub = api()) =>
			payloadOf(sheets).pipe(Effect.flatMap((payload) => imported(payload, stub)));

		// ── The whole workbook, from bytes to written rows ─────────────────────────────────────────
		const payload = yield* payloadOf(workbook(ROSTER_ROWS, TIME_ENTRY_ROWS));
		assert.deepEqual(Object.keys(payload).toSorted(), [
			'attendance',
			'legal_entity',
			'month',
			'roster',
			'timezone'
		]);
		assert.equal(payload.legal_entity, 'Public Fixture Co');
		assert.equal(payload.month, MONTH);
		assert.equal(payload.timezone, 'Asia/Kuala_Lumpur');
		assert.equal(payload.roster.length, 62, 'every filled roster cell is one row');
		assert.deepEqual(payload.roster[0], {
			employee_number: 'PUBEM0002',
			work_date: '2026-05-01',
			shift_code: '7.5AM'
		});
		assert.equal(payload.attendance.length, 5);
		assert.deepEqual(
			JSON.parse(JSON.stringify(payload.attendance[4])),
			{ employee_number: 'PUBEM0023', work_date: '2026-05-06', clock_in: '20:31' },
			'an absent close travels as absence'
		);

		const whole = yield* imported(payload);
		assert.equal(whole.rows.length, 62, 'one row per person-day the file names');
		assert.ok(
			whole.rows.every((row) => row.id === undefined),
			'nothing stored yet, so every row is a create'
		);
		assert.ok(
			whole.rows.every((row) => 'shift_definition_id' in row && 'worked_intervals' in row),
			'both halves are stated on every row'
		);
		const may4 = whole.rows.find(
			(row) => row.employment_id === 'employment:2' && row.work_date === '2026-05-04'
		);
		assert.deepEqual(
			may4,
			{
				shift_definition_id: 'shift:75',
				worked_intervals: [{ start: '2026-05-04T00:16:00.000Z', end: '2026-05-04T09:10:00.000Z' }],
				employment_id: 'employment:2',
				work_date: '2026-05-04'
			},
			'a punch is converted in the Settings timezone (KL is UTC+8)'
		);
		const overnight = whole.rows.find(
			(row) => row.employment_id === 'employment:23' && row.work_date === '2026-05-04'
		);
		assert.equal(
			overnight.worked_intervals[0].end,
			'2026-05-04T21:15:00.000Z',
			'a close at or before the open is the next local day (05:15 KL on the 5th is 21:15Z on the 4th)'
		);
		const open = whole.rows.find(
			(row) => row.employment_id === 'employment:23' && row.work_date === '2026-05-06'
		);
		assert.equal(open.worked_intervals[0].end, null, 'an open clock stays open');
		const planOnly = whole.rows.find(
			(row) => row.employment_id === 'employment:2' && row.work_date === '2026-05-01'
		);
		assert.equal(planOnly.worked_intervals, null, 'a day only the roster names has no punch');
		assert.ok(
			!whole.rows.some(
				(row) =>
					'break_minutes' in row ||
					'assignment_code' in row ||
					'planned_origin' in row ||
					'holiday_id' in row
			),
			'only the five columns exist'
		);
		assert.deepEqual(
			(whole.stub.mutated.rosters ?? [])
				.map((row) => `${row.employment_id} ${row.period}`)
				.toSorted(),
			['employment:2 2026-05', 'employment:23 2026-05'],
			'one roster of record per person the Roster sheet names, for the month'
		);
		assert.ok(
			(whole.stub.mutated.rosters ?? []).every(
				(row) => row.id === undefined && Object.keys(row).length === 2
			),
			'a roster is employment and month, nothing else'
		);

		// ── A roster is whole ──────────────────────────────────────────────────────────────────────
		const gap = yield* refusal(() =>
			importOf(
				workbook(
					ROSTER_ROWS.filter((row) => !(row[0] === 'PUBEM0023' && row[1] === '2026-05-13')),
					TIME_ENTRY_ROWS
				)
			)
		);
		assert.match(gap, /A roster covers every day of the month a person is employed/);
		assert.match(gap, /PUBEM0023: 2026-05-13/);
		assert.doesNotMatch(gap, /PUBEM0002/, 'only the person with the gap is named');

		// ── PH is not a code; unknown codes and people; outside the month; duplicates ──────────────
		const ph = yield* refusal(() =>
			importOf(workbook(wholeMonth('PUBEM0002', '7.5AM', { '2026-05-01': 'PH' }), undefined))
		);
		assert.match(ph, /PH is not a roster code/);
		assert.match(ph, /PUBEM0002 on 2026-05-01/);
		const unknownCode = yield* refusal(() =>
			importOf(workbook(wholeMonth('PUBEM0002', '7.5AM', { '2026-05-04': 'NIGHT' }), undefined))
		);
		assert.match(unknownCode, /roster codes are not defined/);
		assert.match(unknownCode, /NIGHT/);
		const unknownEmployee = yield* refusal(() =>
			importOf(workbook([...ROSTER_ROWS, ['PUBEM9999', '2026-05-06', '7.5AM']], undefined))
		);
		assert.match(unknownEmployee, /No approved employment contract covers PUBEM9999 on 2026-05-06/);
		assert.doesNotMatch(unknownEmployee, /PUBEM0002/);
		const outsideMonth = yield* refusal(() =>
			importOf(workbook([...ROSTER_ROWS, ['PUBEM0002', '2026-06-01', '7.5AM']], undefined))
		);
		assert.match(outsideMonth, /do not belong to 2026-05/);
		assert.match(outsideMonth, /PUBEM0002 on 2026-06-01/);
		const duplicated = yield* refusal(() =>
			importOf(workbook([...ROSTER_ROWS, ['PUBEM0002', '2026-05-06', 'REST']], undefined))
		);
		assert.match(duplicated, /repeats the same employee and day/);

		// ── Attendance without a timezone, on a leave day ──────────────────────────────────────────
		const noZone = yield* refusal(() =>
			importOf(workbook(undefined, TIME_ENTRY_ROWS, SETTINGS_NO_TIMEZONE))
		);
		assert.match(noZone, /does not say which timezone/);
		const onLeave = yield* refusal(() =>
			importOf(
				workbook(undefined, TIME_ENTRY_ROWS),
				api({
					leaveEntries: [
						{
							employment_id: 'employment:2',
							kind: 'TIME_OFF',
							approval_id: null,
							from_date: '2026-05-04',
							to_date: '2026-05-04',
							half_day_start: false,
							half_day_end: false
						}
					]
				})
			)
		);
		assert.match(onLeave, /PUBEM0002 on 2026-05-04 is covered by approved leave/);

		// ── The set: what the file names is written, what it does not is removed ──────────────────
		const existing = [
			{
				id: 'day:1',
				employment_id: 'employment:2',
				work_date: '2026-05-04',
				shift_definition_id: 'shift:am',
				worked_intervals: null,
				payslip_id: null
			},
			{
				id: 'day:stale',
				employment_id: 'employment:2',
				work_date: '2026-05-20',
				shift_definition_id: 'shift:75',
				worked_intervals: [{ start: '2026-05-20T00:30:00.000Z', end: '2026-05-20T09:30:00.000Z' }],
				payslip_id: null
			}
		];
		const bothSheets = yield* importOf(
			workbook(ROSTER_ROWS, TIME_ENTRY_ROWS),
			api({
				existingDays: existing,
				rosters: [{ id: 'roster:2', employment_id: 'employment:2', period: MONTH }]
			})
		);
		assert.equal(
			bothSheets.rows.find((row) => row.id === 'day:1')?.shift_definition_id,
			'shift:75',
			'a day the file names is overwritten as an id-bearing update'
		);
		assert.equal(
			bothSheets.rows.find((row) => row.id === 'day:stale')?.shift_definition_id,
			'shift:75',
			'May 20 is in the roster sheet, so it is restated'
		);
		assert.equal(
			bothSheets.rows.find((row) => row.id === 'day:stale')?.worked_intervals,
			null,
			'and its old punch is gone: the Time entries sheet does not name it'
		);
		assert.deepEqual(
			bothSheets.stub.deleted.work_days ?? [],
			[],
			'every stored day was named, so nothing is deleted'
		);
		assert.deepEqual(
			(bothSheets.stub.mutated.rosters ?? []).map((row) => row.employment_id),
			['employment:23'],
			'the roster that already exists is not created twice'
		);

		// A person the file drops loses the month and the roster of record.
		const dropped = yield* importOf(
			workbook(wholeMonth('PUBEM0002', '7.5AM'), []),
			api({
				existingDays: [
					{
						id: 'day:23',
						employment_id: 'employment:23',
						work_date: '2026-05-04',
						shift_definition_id: 'shift:am',
						worked_intervals: null,
						payslip_id: null
					}
				],
				rosters: [{ id: 'roster:23', employment_id: 'employment:23', period: MONTH }]
			})
		);
		assert.deepEqual(dropped.stub.deleted.work_days, ['day:23']);
		assert.deepEqual(dropped.stub.deleted.rosters, ['roster:23']);
		assert.equal(dropped.rows.length, 31);

		// A Roster sheet alone replaces the plan and keeps recorded attendance; an attended day it
		// omits keeps its punch and loses its plan.
		const rosterOnly = yield* importOf(
			workbook(wholeMonth('PUBEM0002', '7.5AM'), undefined),
			api({
				existingDays: [
					{
						id: 'day:attended',
						employment_id: 'employment:23',
						work_date: '2026-05-21',
						shift_definition_id: 'shift:am',
						worked_intervals: [
							{ start: '2026-05-21T00:30:00.000Z', end: '2026-05-21T09:30:00.000Z' }
						],
						payslip_id: null
					},
					{
						id: 'day:planned',
						employment_id: 'employment:23',
						work_date: '2026-05-22',
						shift_definition_id: 'shift:am',
						worked_intervals: null,
						payslip_id: null
					}
				]
			})
		);
		assert.ok(
			rosterOnly.rows.every((row) => !('worked_intervals' in row) || row.id === 'day:attended'),
			'the plan half only'
		);
		assert.deepEqual(
			rosterOnly.rows.find((row) => row.id === 'day:attended'),
			{ id: 'day:attended', shift_definition_id: null },
			'the attended day keeps its punch and loses its plan: an update names only the plan half'
		);
		assert.deepEqual(
			rosterOnly.stub.deleted.work_days,
			['day:planned'],
			'a planned-only day the file omits goes'
		);

		// A Time entries sheet alone touches no plan.
		const clockOnly = yield* importOf(
			workbook(undefined, TIME_ENTRY_ROWS),
			api({
				existingDays: [
					{
						id: 'day:plan',
						employment_id: 'employment:2',
						work_date: '2026-05-04',
						shift_definition_id: 'shift:75',
						worked_intervals: null,
						payslip_id: null
					}
				]
			})
		);
		const clockRow = clockOnly.rows.find((row) => row.id === 'day:plan');
		assert.ok(clockRow && !('shift_definition_id' in clockRow), 'the plan is not restated');
		assert.equal(
			clockOnly.stub.mutated.rosters,
			undefined,
			'attendance creates no roster of record'
		);

		// ── Sealed days: restated unchanged passes, changed or omitted refuses by name ─────────────
		const sealed = [
			{
				id: 'day:sealed',
				employment_id: 'employment:2',
				work_date: '2026-05-04',
				shift_definition_id: 'shift:75',
				worked_intervals: [{ start: '2026-05-04T00:16:00.000Z', end: '2026-05-04T09:10:00.000Z' }],
				payslip_id: 'payslip:1'
			}
		];
		const restated = yield* importOf(
			workbook(ROSTER_ROWS, TIME_ENTRY_ROWS),
			api({ existingDays: sealed })
		);
		assert.ok(
			!restated.rows.some((row) => row.id === 'day:sealed'),
			'a sealed day restated unchanged is left untouched'
		);
		assert.equal(restated.rows.length, 61);
		const changedSealed = yield* refusal(() =>
			importOf(
				workbook(
					ROSTER_ROWS.map((row) =>
						row[0] === 'PUBEM0002' && row[1] === '2026-05-04' ? [row[0], row[1], 'AM0830'] : row
					),
					TIME_ENTRY_ROWS
				),
				api({ existingDays: sealed })
			)
		);
		assert.match(changedSealed, /already taken into account by a payslip/);
		assert.match(changedSealed, /PUBEM0002 on 2026-05-04 \(the file changes it\)/);
		const omittedSealed = yield* refusal(() =>
			importOf(workbook(wholeMonth('PUBEM0023', 'AM0830'), []), api({ existingDays: sealed }))
		);
		assert.match(omittedSealed, /PUBEM0002 on 2026-05-04 \(the file leaves it out\)/);
		const clockChangedSealed = yield* refusal(() =>
			importOf(
				workbook(
					ROSTER_ROWS,
					TIME_ENTRY_ROWS.map((row) =>
						row[0] === 'PUBEM0002' && row[1] === '2026-05-04'
							? [row[0], row[1], '08:16', '18:10']
							: row
					)
				),
				api({ existingDays: sealed })
			)
		);
		assert.match(clockChangedSealed, /PUBEM0002 on 2026-05-04 \(the file changes it\)/);

		// ── Cells the browser refuses before anything is sent ──────────────────────────────────────
		const badCells = yield* refusal(() =>
			payloadOf(
				workbook(
					[
						['PUBEM0002', '04/05/2026', '7.5AM'],
						['PUBEM0023', '', 'PM2030'],
						['', '2026-05-06', '']
					],
					undefined
				)
			)
		);
		assert.match(badCells, /Nothing was written/);
		assert.match(badCells, /Row 2 \(PUBEM0002 on 04\/05\/2026\): work_date is "04\/05\/2026"/);
		assert.match(badCells, /Row 3 \(PUBEM0023\): work_date is empty/);
		assert.match(badCells, /Row 4 \(2026-05-06\): employee_number is empty/);
		const missingColumn = yield* refusal(() =>
			payloadOf([
				['Settings', SETTINGS],
				[
					'Roster',
					[
						['employee_number', 'work_date'],
						['PUBEM0002', '2026-05-04']
					]
				]
			])
		);
		assert.match(missingColumn, /missing column the import needs/);
		assert.match(missingColumn, /No "shift_code" column/);
		const wrongSheet = yield* refusal(() =>
			payloadOf([
				['Read me first', README],
				['Settings', SETTINGS],
				['Sheet1', [ROSTER_HEADERS, ...ROSTER_ROWS]]
			])
		);
		assert.match(wrongSheet, /has neither a "Roster" nor a "Time entries" sheet/);
		const noEntity = yield* refusal(() =>
			payloadOf(
				workbook(ROSTER_ROWS, undefined, [
					['Setting', 'Value'],
					['month', MONTH]
				])
			)
		);
		assert.match(noEntity, /does not say which legal entity/);
		const empty = yield* refusal(() => payloadOf(workbook([], [])));
		assert.match(empty, /nothing to import/);

		// ── The issued month grids: a person down the side, a day across the top ──────────────────
		const gridRow = (employee, cells) => [employee, ...MAY_DAYS.map((day) => cells[day] ?? '')];
		const rosterCells = (employee, code) =>
			Object.fromEntries(
				wholeMonth(employee, code).map(([, date, shift]) => [String(Number(date.slice(8))), shift])
			);
		const gridPayload = yield* payloadOf([
			['Read me first', README],
			['Settings', SETTINGS],
			[
				'Roster',
				[
					['employee_number', ...MAY_DAYS],
					gridRow('PUBEM0002', rosterCells('PUBEM0002', '7.5AM')),
					gridRow('PUBEM0023', rosterCells('PUBEM0023', 'AM0830'))
				]
			],
			[
				'Time entries',
				[
					['employee_number', ...MAY_DAYS],
					gridRow('PUBEM0002', { 4: '08:16-17:10', 5: '08:02-17:05' }),
					gridRow('PUBEM0023', { 4: '20:30-05:15', 5: '20:28-05:02', 6: '20:31' })
				]
			]
		]);
		const plain = (value) => JSON.parse(JSON.stringify(value));
		assert.deepEqual(
			plain(gridPayload.roster),
			plain(payload.roster),
			'the grid reads as the long form does'
		);
		assert.deepEqual(plain(gridPayload.attendance), plain(payload.attendance));
		const gridWritten = yield* imported(gridPayload);
		assert.equal(gridWritten.rows.length, 62);

		console.log(
			'workbook import: the scheduling workbook round trips as a set of the month, and refuses by row.'
		);
	});
	return yield* verification.pipe(Effect.ensuring(tryPromise(() => vite.close())));
});

// repository-health:allow EFF3 -- Node ESM requires one top-level await to propagate the Effect program's exit status.
await Effect.runPromise(program);
