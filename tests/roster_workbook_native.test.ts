/** Native XLSX import, governing-law warnings and payroll capture locks over synthetic employees. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { expect, it } from '@effect/vitest';
import { RunHandlers, type Json } from '@norbital-ai/bolt/engine';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt/test';
import { addDays, Instant, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Option, Schema } from 'effect';
import { SHEET_COLUMNS } from '../src/lib/payroll_engine/roster_sheet.js';
import { fixtureId, nativeId } from './fixture_values.js';
import { lineage, world, type Tables } from './jurisdiction_kit.js';

const LAW = lineage('PH');
const VERSION = LAW.versionOn('2026-03-01');
const SETTINGS = nativeId('jurisdiction_settings', LAW.settingsOf(VERSION).id);
const COMPANY = nativeId('entity', fixtureId('workbook-native-company'));
const PERSON = nativeId('employment_profile', fixtureId('workbook-native-person'));
const EMPLOYMENT = nativeId('employment_contract', fixtureId('workbook-native-employment'));
const OT_PERSON = nativeId('employment_profile', fixtureId('workbook-native-ot-person'));
const OT_EMPLOYMENT = nativeId('employment_contract', fixtureId('workbook-native-ot-employment'));
const WORK = nativeId('shift_definition', fixtureId('workbook-native-work-shift'));
const REST = nativeId('shift_definition', fixtureId('workbook-native-rest-shift'));
const ALTERNATE = nativeId('shift_definition', fixtureId('workbook-native-alternate-shift'));
const MONTH = { from: PlainDate('2026-03-01'), to: PlainDate('2026-03-31') };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const HEADER = [
	'Employee number',
	'Date',
	'Shift',
	'Clock in',
	'Clock out',
	'OT consent',
	'Banked overtime hours',
	'Leave',
	'Name',
	'Holiday'
];
type Cell = string | number | null;
const weeklyRest = Schema.decodeUnknownSync(
	Schema.Struct({
		rules: Schema.Struct({
			site: Schema.Literal('roster'),
			kind: Schema.Literal('warn'),
			message: Schema.String
		})
	})
)(LAW.byCode(VERSION, 'rule_set', 'ROSTER_WEEKLY_REST'));

const sheetRow = (
	date: string,
	shift: string | null = 'DWORK09-17',
	clockIn: string | null = '09:00',
	clockOut: string | null = '17:00',
	number = 'WORK-1',
	consent: string | null = null
): Cell[] => [number, date, shift, clockIn, clockOut, consent, null, null, number, null];
const monthRows = (number = 'WORK-1'): Cell[][] =>
	Array.from({ length: 31 }, (_, index) => {
		const date = addDays(MONTH.from, index);
		return index % 7 === 6
			? sheetRow(date, 'RREST', null, null, number)
			: sheetRow(date, 'DWORK09-17', '09:00', '17:00', number);
	});

function tables(
	options: {
		readonly precedingSix?: boolean;
		readonly overtimeEmployee?: boolean;
		readonly employees?: number;
		readonly cutoffProbe?: boolean;
	} = {}
): Tables {
	const rows = LAW.law();
	rows.set('entity', [
		{
			id: COMPANY,
			name: 'Synthetic workbook PH company',
			settings_code: 'PH',
			region: 'IV-A',
			time_zone: 'Asia/Manila',
			pay_frequency: 'MONTHLY',
			pay_cutoff_day: options.cutoffProbe ? 21 : 1,
			effective_range: { from: '2025-12-01', to: null },
			facts: { small_establishment: false }
		}
	]);
	const people = [
		...Array.from({ length: options.employees ?? 1 }, (_, index) => ({
			person:
				index === 0
					? PERSON
					: nativeId('employment_profile', fixtureId(`workbook-native-scale-person-${index}`)),
			employment:
				index === 0
					? EMPLOYMENT
					: nativeId('employment_contract', fixtureId(`workbook-native-scale-employment-${index}`)),
			number: `WORK-${index + 1}`
		})),
		...(options.overtimeEmployee
			? [{ person: OT_PERSON, employment: OT_EMPLOYMENT, number: 'WORK-2' }]
			: [])
	];
	rows.set(
		'employment_profile',
		people.map(({ person, number }) => ({
			id: person,
			name: `Synthetic workbook employee ${number}`,
			email: `${number.toLowerCase()}@example.com`,
			date_of_birth: '1990-01-01',
			nationality: 'PH',
			facts: {}
		}))
	);
	rows.set(
		'employment_contract',
		people.map(({ person, employment, number }) => ({
			id: employment,
			employee_id: person,
			company_id: COMPANY,
			employee_number: number,
			contract_number: 1,
			engagement: 'EMPLOYEE',
			effective_range: { from: '2025-12-01', to: null },
			facts: {
				contract_terms: [
					{
						effective_range: { from: '2025-12-01', to: null },
						base_salary: { value: 30000, currency: 'PHP' },
						residency_status: 'CITIZEN',
						work_classification: 'RANK_AND_FILE',
						statutory_work_category: 'NON_FIELD',
						employment_type: 'PERMANENT',
						allowances: [],
						facts: { days_per_year: 313, hours_per_day: 8 }
					}
				]
			}
		}))
	);
	rows.set('shift_definition', [
		{
			id: WORK,
			company_id: COMPANY,
			code: 'DWORK09-17',
			variant: { day_type: 'WORK', start_time: '09:00', end_time: '17:00', break_minutes: 0 },
			effective_range: { from: '2025-12-01', to: null }
		},
		{
			id: REST,
			company_id: COMPANY,
			code: 'RREST',
			variant: { day_type: 'REST' },
			effective_range: { from: '2025-12-01', to: null }
		},
		...(options.cutoffProbe
			? [
					{
						id: ALTERNATE,
						company_id: COMPANY,
						code: 'DALT09-17',
						variant: { day_type: 'WORK', start_time: '09:00', end_time: '17:00', break_minutes: 0 },
						effective_range: { from: '2025-12-01', to: null }
					}
				]
			: [])
	]);
	rows.set(
		'roster_entry',
		options.precedingSix
			? Array.from({ length: 6 }, (_, index) => {
					const date = addDays('2026-02-23', index);
					return {
						id: fixtureId(`workbook-native-preceding-${date}`),
						employment_id: EMPLOYMENT,
						work_date: date,
						shift_definition_id: WORK,
						worked_intervals: [{ start: `${date}T01:00:00.000Z`, end: `${date}T09:00:00.000Z` }],
						facts: {}
					};
				})
			: []
	);
	for (const name of [
		'shift_pattern',
		'holiday',
		'work_suspension',
		'leave_catalog_entry',
		'adhoc_catalog_entry',
		'claim_catalog_entry',
		'loan_catalog_entry',
		'loan_repayment_entry',
		'payslip',
		'payroll_run'
	])
		rows.set(name, []);
	return rows;
}

class WorkbookIoFailed extends Schema.TaggedError<WorkbookIoFailed>()('WorkbookIoFailed', {
	message: Schema.String
}) {}
const ImportReply = Schema.Struct({
	applied: Schema.Boolean,
	created: Schema.optionalKey(Schema.Number),
	updated: Schema.optionalKey(Schema.Number),
	deleted: Schema.optionalKey(Schema.Number),
	findings: Schema.Array(
		Schema.Struct({
			row: Schema.NullOr(Schema.Number),
			severity: Schema.String,
			message: Schema.String
		})
	)
});
const importWorkbook = Effect.fnUntraced(function* (
	t: Kit,
	cells: readonly (readonly Cell[])[],
	accept: boolean,
	context: { readonly from: PlainDate; readonly to: PlainDate } = MONTH,
	starter: Kit['admin'] = t.admin
) {
	const book = new ExcelJS.Workbook();
	const sheet = book.addWorksheet('Work days');
	for (const cellsOfRow of cells) sheet.addRow([...cellsOfRow]);
	const buffer = yield* Effect.tryPromise({
		try: () => book.xlsx.writeBuffer(),
		catch: (cause) => new WorkbookIoFailed({ message: String(cause) })
	});
	const upload = yield* t.as(starter).upload('roster_entry.$import', {
		name: 'synthetic-work-days.xlsx',
		mime: XLSX,
		bytes: new Uint8Array(buffer)
	});
	assert.equal(upload.kind, 'committed');
	if (upload.kind !== 'committed') throw new Error('The caller upload must commit.');
	const handler = yield* (yield* RunHandlers).handler('roster_entry.pipeline');
	if (Option.isNone(handler)) throw new Error('The real roster import handler must be registered.');
	const input: Json = {
		mode: 'import',
		file: upload.output.id,
		context: { company_id: COMPANY, ...context },
		accept
	};
	return yield* Schema.decodeUnknownEffect(ImportReply)(
		yield* handler.value(input, { id: randomUUID(), starter })
	);
});
const storedRoster = Effect.fnUntraced(function* (t: Kit) {
	return (yield* t.storedRead('roster_entry', { all: true })).rows.toSorted((left, right) =>
		left.id.localeCompare(right.id)
	);
});

it.live(
	'a native XLSX round-trips historical OT windows and explicitly clears them without fabricating consent',
	() =>
		world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const headers = Object.values(SHEET_COLUMNS);
				const row = sheetRow('2026-03-02', 'DWORK09-17', '07:00', '19:00');
				const cells = [
					headers,
					[
						...row,
						3.5,
						'2026-03-02T07:00:17+08:00',
						'2026-03-02T09:00:00+08:00',
						'2026-03-02T17:00:00+08:00',
						'2026-03-02T19:00:43+08:00',
						30,
						null
					]
				];
				expect(yield* importWorkbook(t, cells, true)).toMatchObject({
					applied: true,
					created: 1,
					updated: 0,
					deleted: 0
				});
				const before = yield* storedRoster(t);
				assert.deepEqual(
					before[0]?.approved_overtime_intervals?.map(({ start, end }) => ({ start, end })),
					[
						{ start: '2026-03-01T23:00:17.000Z', end: '2026-03-02T01:00:00.000Z' },
						{ start: '2026-03-02T09:00:00.000Z', end: '2026-03-02T11:00:43.000Z' }
					]
				);
				assert.equal(before[0]?.approved_overtime_intervals?.[0]?.break_minutes, 30);
				assert.equal(before[0]?.approved_overtime_intervals?.[1]?.break_minutes ?? 0, 0);
				assert.equal(before[0]?.overtime_consented_at, null);
				const context = { from: PlainDate('2026-03-02'), to: PlainDate('2026-03-02') };
				const exported = yield* templateCells(t, context);
				assert.equal(exported[1]?.[15], 30);
				expect(yield* importWorkbook(t, exported, true, context)).toMatchObject({
					applied: true,
					created: 0,
					updated: 0,
					deleted: 0
				});
				expect(yield* importWorkbook(t, [HEADER, row], true)).toMatchObject({
					applied: true,
					created: 0,
					updated: 0,
					deleted: 0
				});
				expect(yield* importWorkbook(t, [headers, row], true)).toMatchObject({
					applied: true,
					created: 0,
					updated: 0,
					deleted: 0
				});
				assert.deepEqual(yield* storedRoster(t), before);
				expect(yield* importWorkbook(t, [headers, [...row, null, 'CLEAR']], true)).toMatchObject({
					applied: true,
					created: 0,
					updated: 1,
					deleted: 0
				});
				assert.equal((yield* storedRoster(t))[0]?.approved_overtime_intervals, null);
			})
		),
	{ timeout: 15_000 }
);

it.live(
	'leave-covered XLSX days keep plans and no-work markers, allow half-day clocks, and retain payroll locks',
	() => {
		const seed = tables();
		const catalog = nativeId(
			'leave_catalog',
			LAW.byCode(VERSION, 'leave_catalog', 'UNPAID_LEAVE').id
		);
		seed.set(
			'leave_catalog_entry',
			['2026-03-02', '2026-03-03', '2026-03-04'].map((date, index) => ({
				id: fixtureId(`workbook-native-leave-${date}`),
				catalog_id: catalog,
				employment_id: EMPLOYMENT,
				company_id: COMPANY,
				activity: 'TIME_OFF',
				occurred_on: date,
				from: date,
				to: date,
				days: index === 2 ? 0.5 : 1,
				half_day_start: index === 2,
				facts: {}
			}))
		);
		return world(seed).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.admin);
				const cells = [
					HEADER,
					sheetRow('2026-03-02', 'DWORK09-17', '00:00', '00:00'),
					sheetRow('2026-03-03', 'DWORK09-17', null, null),
					sheetRow('2026-03-04', 'DWORK09-17', '09:00', '13:00')
				];
				expect(yield* importWorkbook(t, cells, true)).toMatchObject({
					applied: true,
					created: 3
				});
				const before = yield* storedRoster(t);
				const zero = before.find((row) => row.work_date === '2026-03-02');
				const blank = before.find((row) => row.work_date === '2026-03-03');
				const half = before.find((row) => row.work_date === '2026-03-04');
				assert.ok(zero && blank && half);
				assert.deepEqual(zero.worked_intervals, []);
				assert.equal(blank.worked_intervals, null);
				assert.equal(half.worked_intervals?.length, 1);
				assert.ok(before.every((row) => row.shift_definition_id === WORK));
				const leaveBefore = (yield* t.storedRead('leave_catalog_entry', { all: true })).rows;
				for (const replacement of [
					sheetRow('2026-03-02'),
					['WORK-1', '2026-03-02', 'DWORK09-17', '00:00', '00:00', null, 1, null, null, null],
					sheetRow('2026-03-02', 'DWORK09-17', '00:00', '00:00', 'WORK-1', 'Y')
				]) {
					const rejected = yield* importWorkbook(t, [HEADER, replacement, ...cells.slice(2)], true);
					assert.equal(rejected.applied, false);
					assert.ok(rejected.findings.some((finding) => /full-day.*leave/i.test(finding.message)));
					assert.deepEqual(yield* storedRoster(t), before);
				}
				const direct = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: [zero.id],
						set: {
							worked_intervals: [
								{
									start: Instant('2026-03-02T01:00:00.000Z'),
									end: Instant('2026-03-02T05:00:00.000Z')
								}
							]
						}
					})
				);
				assert.match(direct.message, /leave.*covers/i);
				assert.deepEqual(yield* storedRoster(t), before);
				expect(yield* importWorkbook(t, cells, true)).toMatchObject({
					applied: true,
					created: 0,
					updated: 0,
					deleted: 0
				});
				const run = yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				});
				assert.equal(run.kind, 'committed');
				const captured = yield* storedRoster(t);
				const moved = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: [zero.id],
						set: { shift_definition_id: REST }
					})
				);
				assert.match(moved.message, /paid|payroll|settled/i);
				assert.deepEqual(yield* storedRoster(t), captured);
				assert.deepEqual(
					(yield* t.storedRead('leave_catalog_entry', { all: true })).rows,
					leaveBefore
				);
			})
		);
	},
	{ timeout: 15_000 }
);

it.live(
	'a monthly XLSX preserves locked cutoff days and lets HR change only the remaining shift plans',
	() =>
		world(tables({ cutoffProbe: true })).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				assert.equal(HEADER.length, 10);
				assert.deepEqual(Object.values(SHEET_COLUMNS).slice(0, HEADER.length), HEADER);
				assert.equal(Object.values(SHEET_COLUMNS)[10], 'Planned OT hours');
				assert.deepEqual(Object.values(SHEET_COLUMNS).slice(11), [
					'Approved OT 1 start',
					'Approved OT 1 end',
					'Approved OT 2 start',
					'Approved OT 2 end',
					'Approved OT 1 break minutes',
					'Approved OT 2 break minutes'
				]);
				const cells = [
					HEADER,
					...monthRows().map((row) =>
						row[1] === '2026-03-02'
							? sheetRow('2026-03-02', 'DWORK09-17', '09:00', '19:54', 'WORK-1', 'Y')
							: row
					)
				];
				const first = yield* importWorkbook(t, cells, true);
				expect(first).toMatchObject({ applied: true, created: 31, updated: 0, deleted: 0 });
				assert.deepEqual(first.findings, []);
				const before = yield* storedRoster(t);
				assert.equal(before.length, 31);
				assert.equal(before.filter((row) => row.shift_definition_id === REST).length, 4);
				assert.equal(before.filter((row) => row.worked_intervals != null).length, 27);
				assert.deepEqual(
					before.map((row) => row.work_date).sort(),
					monthRows().map((row) => row[1])
				);
				const again = yield* importWorkbook(t, cells, true);
				expect(again).toMatchObject({ applied: true, created: 0, updated: 0, deleted: 0 });
				assert.deepEqual(yield* storedRoster(t), before);
				const planned = before.find((row) => row.work_date === PlainDate('2026-03-02'));
				assert.ok(planned);
				yield* t.as(t.admin).act('roster_entry.update', {
					target: planned.id,
					set: {
						planned_overtime_hours: Decimal.of('3'),
						approved_overtime_intervals: [
							{
								start: Instant('2026-03-02T09:00:00.000Z'),
								end: Instant('2026-03-02T12:00:00.000Z'),
								break_minutes: 30
							}
						]
					}
				});
				yield* t.as(t.admin).act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				});
				yield* t.runDue();
				yield* t.settled();
				const captured = yield* storedRoster(t);
				const [run] = (yield* t.storedRead('payroll_run', { all: true })).rows;
				assert.ok(run);
				assert.equal(run.attendance_from, '2026-02-21');
				assert.equal(run.attendance_to, '2026-03-20');
				const ledger = Schema.decodeUnknownSync(
					Schema.Array(
						Schema.Struct({
							collection: Schema.String,
							id: Schema.String,
							employment_id: Schema.String
						})
					)
				)(run.pins ?? []);
				const consumed = new Set(
					ledger.filter((pin) => pin.collection === 'roster_entry').map((pin) => pin.id)
				);
				assert.equal(consumed.size, 20);
				assert.equal(captured.filter((row) => row.payslip_id == null).length, 11);
				for (const row of captured) assert.equal(row.payslip_id != null, consumed.has(row.id));
				const locked = captured.find((row) => row.id === planned.id);
				const unlocked = captured.find(
					(row) => row.payslip_id == null && row.shift_definition_id === WORK
				);
				assert.ok(locked?.payslip_id && unlocked);
				const hr = t.member(['hr_manager'], {
					teams: ['019f8a10-0000-7000-8000-000000000006']
				});
				const unchanged = yield* importWorkbook(t, cells, true, MONTH, hr);
				expect(unchanged, JSON.stringify(unchanged)).toMatchObject({
					applied: true,
					created: 0,
					updated: 0,
					deleted: 0
				});
				assert.deepEqual(yield* storedRoster(t), captured);
				const clearLocked = yield* importWorkbook(
					t,
					[
						Object.values(SHEET_COLUMNS),
						...cells
							.slice(1)
							.map((row) => (row[1] === String(locked.work_date) ? [...row, null, 'CLEAR'] : row))
					],
					true,
					MONTH,
					hr
				);
				assert.equal(clearLocked.applied, false);
				assert.ok(
					clearLocked.findings.some((finding) =>
						/settled|captured by payroll/.test(finding.message)
					)
				);
				assert.deepEqual(yield* storedRoster(t), captured);
				const changed = cells.map((row) =>
					row[1] === String(locked.work_date) || row[1] === String(unlocked.work_date)
						? row.map((value, column) => (column === 2 ? 'DALT09-17' : value))
						: row
				);
				const mixed = yield* importWorkbook(
					t,
					[...changed, sheetRow('2026-04-01')],
					true,
					{ from: MONTH.from, to: PlainDate('2026-04-01') },
					hr
				);
				assert.equal(mixed.applied, false);
				assert.ok(
					mixed.findings.some(
						(finding) =>
							finding.severity === 'refuse' && /settled|captured|payroll/i.test(finding.message)
					)
				);
				assert.deepEqual(yield* storedRoster(t), captured);
				const unlockedOnly = cells.map((row) =>
					row[1] === String(unlocked.work_date)
						? row.map((value, column) => (column === 2 ? 'DALT09-17' : value))
						: row
				);
				expect(yield* importWorkbook(t, unlockedOnly, true, MONTH, hr)).toMatchObject({
					applied: true,
					created: 0,
					updated: 1,
					deleted: 0
				});
				const afterUnlocked = yield* storedRoster(t);
				assert.deepEqual(
					afterUnlocked.filter((row) => consumed.has(row.id)),
					captured.filter((row) => consumed.has(row.id))
				);
				assert.equal(
					afterUnlocked.find((row) => row.id === unlocked.id)?.shift_definition_id,
					ALTERNATE
				);
				for (const set of [{ shift_definition_id: REST }, { payslip_id: null }]) {
					const refused = yield* Effect.flip(
						t.as(hr).act('roster_entry.update', {
							target: locked.id,
							set
						})
					);
					assert.match(refused.message, /settled|captured|payroll/i);
					assert.deepEqual(yield* storedRoster(t), afterUnlocked);
				}
			})
		),
	{ timeout: 15_000 }
);

it.live(
	'a full 88-person monthly XLSX retains unchanged days across fourteen scattered additions and shift changes',
	() =>
		world(tables({ employees: 88, cutoffProbe: true })).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const additions = new Map<string, string>(
					Array.from(
						{ length: 14 },
						(_, index) => [`WORK-${75 + index}`, addDays(MONTH.from, 1 + index * 2)] as const
					)
				);
				const changedNumbers = new Set(
					Array.from({ length: 14 }, (_, index) => `WORK-${index + 1}`)
				);
				const isAddition = (row: readonly Cell[]) => additions.get(String(row[0])) === row[1];
				const cells = [
					HEADER,
					...Array.from({ length: 88 }, (_, index) => monthRows(`WORK-${index + 1}`))
						.flat()
						.map((row) =>
							isAddition(row)
								? sheetRow(String(row[1]), 'DALT09-17', null, null, String(row[0]))
								: row
						)
				];
				assert.equal(cells.length - 1, 2728);
				const initial = cells.filter((row) => !isAddition(row));
				const imported = yield* importWorkbook(t, initial, true);
				expect(imported).toMatchObject({ applied: true, created: 2714, updated: 0, deleted: 0 });
				assert.deepEqual(imported.findings, []);
				const before = yield* storedRoster(t);
				assert.equal(before.length, 2714);
				assert.equal(new Set(before.map((row) => row.employment_id)).size, 88);
				const revised = cells.map((row) =>
					changedNumbers.has(String(row[0])) && row[1] === '2026-03-30'
						? row.map((value, column) => (column === 2 ? 'DALT09-17' : value))
						: row
				);
				assert.equal(revised.length - 1, 2728);
				const updated = yield* importWorkbook(t, revised, true);
				expect(updated).toMatchObject({ applied: true, created: 14, updated: 14, deleted: 0 });
				assert.deepEqual(updated.findings, []);
				const after = yield* storedRoster(t);
				assert.equal(after.length, 2728);
				const beforeIds = new Set(before.map((row) => row.id));
				const changedEmployments = new Set(
					Array.from({ length: 14 }, (_, index) =>
						index === 0
							? EMPLOYMENT
							: nativeId(
									'employment_contract',
									fixtureId(`workbook-native-scale-employment-${index}`)
								)
					)
				);
				const changedIds = new Set(
					before
						.filter(
							(row) => changedEmployments.has(row.employment_id) && row.work_date === '2026-03-30'
						)
						.map((row) => row.id)
				);
				assert.equal(changedIds.size, 14);
				assert.ok(
					after
						.filter((row) => changedIds.has(row.id))
						.every((row) => row.shift_definition_id === ALTERNATE)
				);
				assert.deepEqual(
					after.filter((row) => beforeIds.has(row.id) && !changedIds.has(row.id)),
					before.filter((row) => !changedIds.has(row.id))
				);
				const added = after.filter((row) => !beforeIds.has(row.id));
				assert.equal(added.length, 14);
				assert.ok(
					added.every(
						(row) => row.shift_definition_id === ALTERNATE && row.worked_intervals == null
					)
				);
				expect(yield* importWorkbook(t, revised, true)).toMatchObject({
					applied: true,
					created: 0,
					updated: 0,
					deleted: 0
				});
				assert.deepEqual(yield* storedRoster(t), after);
			})
		),
	{ timeout: 15_000 }
);

it.live(
	'an unchanged banked-overtime neighbor keeps its full guard when used as weekly import context',
	() => {
		const seed = tables();
		seed.set('roster_entry', [
			{
				id: fixtureId('workbook-native-overbanked-neighbor'),
				employment_id: EMPLOYMENT,
				work_date: '2026-03-02',
				shift_definition_id: WORK,
				planned_overtime_hours: 2,
				banked_overtime_hours: 3,
				worked_intervals: [{ start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T11:00:00.000Z' }],
				facts: {}
			}
		]);
		return world(seed).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const before = yield* storedRoster(t);
				const reply = yield* importWorkbook(t, [HEADER, sheetRow('2026-03-03')], true, {
					from: PlainDate('2026-03-03'),
					to: PlainDate('2026-03-03')
				});
				assert.equal(reply.applied, false);
				assert.ok(
					reply.findings.some(
						(finding) =>
							finding.severity === 'refuse' &&
							/banked overtime cannot exceed/i.test(finding.message)
					)
				);
				assert.deepEqual(yield* storedRoster(t), before);
			})
		);
	},
	{ timeout: 15_000 }
);

it.live(
	'a full monthly reimport warns on a changed seventh day and all six unchanged following days',
	() =>
		world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const cells = [HEADER, ...monthRows()];
				const initial = yield* importWorkbook(t, cells, true);
				expect(initial).toMatchObject({ applied: true, created: 31, updated: 0, deleted: 0 });
				assert.deepEqual(initial.findings, []);
				const before = yield* storedRoster(t);
				const revised = cells.map((row) =>
					row[1] === '2026-03-07' ? sheetRow('2026-03-07') : row
				);
				assert.equal(revised.length - 1, 31);
				const preview = yield* importWorkbook(t, revised, false);
				assert.equal(preview.applied, false);
				assert.equal(
					preview.findings.some((finding) => finding.severity === 'refuse'),
					false
				);
				assert.deepEqual(
					preview.findings
						.filter((finding) => finding.message.includes(weeklyRest.rules.message))
						.map((finding) => finding.row),
					[8, 9, 10, 11, 12, 13, 14]
				);
				assert.deepEqual(yield* storedRoster(t), before);
				const accepted = yield* importWorkbook(t, revised, true);
				expect(accepted).toMatchObject({ applied: true, created: 0, updated: 1, deleted: 0 });
				assert.deepEqual(accepted.findings, preview.findings);
				const after = yield* storedRoster(t);
				assert.equal(after.length, 31);
				assert.deepEqual(
					after.filter((row) => row.work_date !== '2026-03-07'),
					before.filter((row) => row.work_date !== '2026-03-07')
				);
				const worked = after.find((row) => row.work_date === '2026-03-07');
				assert.equal(worked?.shift_definition_id, WORK);
				assert.equal(worked?.worked_intervals?.length, 1);
			})
		),
	{ timeout: 15_000 }
);

it.live(
	'the declared PH seventh-day warning crosses the stored/file boundary and requires acknowledgement',
	() =>
		world(tables({ precedingSix: true })).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const before = yield* storedRoster(t);
				assert.equal(before.length, 6);
				const cells = [HEADER, sheetRow('2026-03-01')];
				const context = { from: MONTH.from, to: MONTH.from };
				const preview = yield* importWorkbook(t, cells, false, context);
				assert.equal(preview.applied, false);
				assert.ok(
					preview.findings.some(
						(finding) =>
							finding.severity === 'warn' && finding.message.includes(weeklyRest.rules.message)
					)
				);
				assert.equal(
					preview.findings.some((finding) => finding.severity === 'refuse'),
					false
				);
				assert.deepEqual(yield* storedRoster(t), before);
				const accepted = yield* importWorkbook(t, cells, true, context);
				expect(accepted).toMatchObject({ applied: true, created: 1, updated: 0, deleted: 0 });
				assert.ok(accepted.findings.some((finding) => finding.severity === 'warn'));
				assert.equal((yield* storedRoster(t)).length, 7);
			})
		),
	{ timeout: 15_000 }
);

it.live(
	'clock-only XLSX rows count actual days for the PH seventh-day warning without requiring a planned shift',
	() =>
		world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const six = [
					HEADER,
					...Array.from({ length: 6 }, (_, index) => sheetRow(addDays('2026-03-02', index), null))
				];
				const first = yield* importWorkbook(t, six, false, {
					from: PlainDate('2026-03-02'),
					to: PlainDate('2026-03-07')
				});
				expect(first).toMatchObject({ applied: true, created: 6, updated: 0, deleted: 0 });
				assert.equal(
					first.findings.some((finding) => finding.message.includes(weeklyRest.rules.message)),
					false
				);
				const before = yield* storedRoster(t);
				assert.equal(before.length, 6);
				assert.ok(
					before.every(
						(row) => row.shift_definition_id == null && row.worked_intervals?.length === 1
					)
				);
				const seventh = [HEADER, sheetRow('2026-03-08', null)];
				const context = { from: PlainDate('2026-03-08'), to: PlainDate('2026-03-08') };
				const preview = yield* importWorkbook(t, seventh, false, context);
				assert.equal(preview.applied, false);
				assert.ok(
					preview.findings.some(
						(finding) =>
							finding.severity === 'warn' && finding.message.includes(weeklyRest.rules.message)
					)
				);
				assert.equal(
					preview.findings.some((finding) => finding.severity === 'refuse'),
					false
				);
				assert.deepEqual(yield* storedRoster(t), before);
				expect(yield* importWorkbook(t, seventh, true, context)).toMatchObject({
					applied: true,
					created: 1,
					updated: 0,
					deleted: 0
				});
				const after = yield* storedRoster(t);
				assert.equal(after.length, 7);
				assert.ok(
					after.every(
						(row) => row.shift_definition_id == null && row.worked_intervals?.length === 1
					)
				);
			})
		),
	{ timeout: 15_000 }
);

it.live(
	'native payroll captures ordinary and overtime days, protects pending backlinks and preserves unchanged imports',
	() =>
		world(tables({ overtimeEmployee: true })).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const actor = t.as(t.admin);
				// Both ordinary attendance and a second employee's overtime must have their own capture ledger and FK.
				const cells = [
					[...HEADER, 'Planned OT hours'],
					...monthRows(),
					[...sheetRow('2026-03-02', 'DWORK09-17', '09:00', '19:00', 'WORK-2', 'Y'), 2]
				];
				expect(yield* importWorkbook(t, cells, true)).toMatchObject({ applied: true, created: 32 });
				const run = yield* actor.act('payroll_run.create', {
					company_id: COMPANY,
					period: '2026-03',
					kind: 'REGULAR'
				});
				assert.equal(run.kind, 'committed');
				// The owned DRAFT slip already captures this window, before asynchronous ledger pins run.
				const draftRows = yield* storedRoster(t);
				const draftOrdinary = draftRows.find(
					(row) => row.employment_id === EMPLOYMENT && row.work_date === '2026-03-02'
				);
				assert.ok(draftOrdinary);
				assert.equal(draftOrdinary.payslip_id, null);
				const draftMove = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: [draftOrdinary.id],
						set: { work_date: PlainDate('2026-04-02') }
					})
				);
				assert.match(draftMove.message, /paid|payroll|settled/i);
				const draftClock = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: [draftOrdinary.id],
						set: {
							worked_intervals: [
								{
									start: Instant('2026-03-02T01:00:00.000Z'),
									end: Instant('2026-03-02T10:00:00.000Z')
								}
							]
						}
					})
				);
				assert.match(draftClock.message, /paid|payroll|settled/i);
				assert.deepEqual(yield* storedRoster(t), draftRows);
				yield* t.runDue();
				yield* t.settled();
				const storedRuns = (yield* t.storedRead('payroll_run', { all: true })).rows;
				assert.equal(storedRuns.length, 1);
				assert.equal(storedRuns[0]?.settings_id, SETTINGS);
				const slips = (yield* t.storedRead('payslip', { all: true })).rows;
				assert.equal(slips.length, 2);
				assert.ok(slips.every((slip) => slip.gross.cmp(0) > 0));
				const before = yield* storedRoster(t);
				const ordinary = before.find(
					(row) => row.employment_id === EMPLOYMENT && row.work_date === '2026-03-02'
				);
				const pinned = before.find(
					(row) => row.employment_id === OT_EMPLOYMENT && row.payslip_id != null
				);
				assert.ok(ordinary && pinned);
				const ordinarySlip = slips.find((slip) => slip.employment_id === EMPLOYMENT);
				const overtimeSlip = slips.find((slip) => slip.employment_id === OT_EMPLOYMENT);
				assert.ok(ordinarySlip && overtimeSlip);
				assert.equal(ordinary.payslip_id, ordinarySlip.id);
				assert.equal(pinned.payslip_id, overtimeSlip.id);
				assert.ok(before.every((row) => row.payslip_id != null));
				const ledger = Schema.decodeUnknownSync(
					Schema.Array(
						Schema.Struct({
							collection: Schema.String,
							id: Schema.String,
							employment_id: Schema.String
						})
					)
				)(storedRuns[0]?.pins ?? []);
				assert.ok(
					ledger.some(
						(pin) =>
							pin.collection === 'roster_entry' &&
							pin.id === ordinary.id &&
							pin.employment_id === EMPLOYMENT
					)
				);
				assert.ok(
					ledger.some(
						(pin) =>
							pin.collection === 'roster_entry' &&
							pin.id === pinned.id &&
							pin.employment_id === OT_EMPLOYMENT
					)
				);
				expect(yield* importWorkbook(t, cells, true)).toMatchObject({
					applied: true,
					created: 0,
					updated: 0,
					deleted: 0
				});
				assert.deepEqual(yield* storedRoster(t), before);

				const changed = cells.map((row) =>
					row[0] === 'WORK-1' && row[1] === '2026-03-02'
						? sheetRow('2026-03-02', 'DWORK09-17', '09:00', '18:00')
						: row
				);
				const changedReply = yield* importWorkbook(t, changed, true);
				assert.equal(changedReply.applied, false);
				assert.ok(
					changedReply.findings.some(
						(finding) =>
							finding.severity === 'refuse' && /paid|payroll|settled/i.test(finding.message)
					)
				);
				assert.deepEqual(yield* storedRoster(t), before);
				const omitted = cells.filter((row) => !(row[0] === 'WORK-1' && row[1] === '2026-03-10'));
				const omittedReply = yield* importWorkbook(t, omitted, true);
				assert.equal(omittedReply.applied, false);
				assert.ok(
					omittedReply.findings.some(
						(finding) =>
							finding.severity === 'refuse' && /paid|payroll|settled/i.test(finding.message)
					)
				);
				assert.deepEqual(yield* storedRoster(t), before);

				const moved = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: [ordinary.id],
						set: { work_date: PlainDate('2026-04-02') }
					})
				);
				assert.match(moved.message, /paid|payroll|settled/i);
				assert.deepEqual(yield* storedRoster(t), before);
				const unlinked = yield* Effect.flip(
					actor.act('roster_entry.update', {
						target: [pinned.id],
						set: { payslip_id: null }
					})
				);
				assert.match(unlinked.message, /paid|payroll|settled/i);
				assert.deepEqual(yield* storedRoster(t), before);

				// Deleting the unpaid run removes its captured window and releases its real ledger pins.
				const storedRun = storedRuns[0];
				assert.ok(storedRun);
				yield* actor.act('payroll_run.delete', { target: [storedRun.id] });
				yield* t.runDue();
				yield* t.settled();
				assert.equal((yield* t.storedRead('payslip', { all: true })).rows.length, 0);
				yield* actor.act('roster_entry.update', {
					target: [ordinary.id],
					set: {
						work_date: PlainDate('2026-04-02'),
						worked_intervals: [
							{
								start: Instant('2026-04-02T01:00:00.000Z'),
								end: Instant('2026-04-02T09:00:00.000Z')
							}
						]
					}
				});
				const released = (yield* storedRoster(t)).find((row) => row.id === ordinary.id);
				assert.ok(released);
				assert.equal(released.work_date, '2026-04-02');
				assert.equal(released.payslip_id, null);
			})
		),
	{ timeout: 15_000 }
);

const clockCells = (date: string, clockIn: Cell, clockOut: Cell): Cell[] => {
	const row = sheetRow(date);
	row[3] = clockIn;
	row[4] = clockOut;
	return row;
};
const excelSerial = (local: string): number =>
	(Date.parse(`${local}Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
const templateCells = Effect.fnUntraced(function* (
	t: Kit,
	context: { readonly from: PlainDate; readonly to: PlainDate }
) {
	const handler = yield* (yield* RunHandlers).handler('roster_entry.pipeline');
	if (Option.isNone(handler))
		throw new Error('The real roster template handler must be registered.');
	const output = yield* handler.value(
		{ mode: 'template', context: { company_id: COMPANY, ...context } },
		{ id: randomUUID(), starter: t.admin }
	);
	const { file } = yield* Schema.decodeUnknownEffect(
		Schema.Struct({ file: Schema.Struct({ id: Schema.String }) })
	)(output);
	const stored = yield* t.db.one(Schema.Struct({ key: Schema.String }), {
		text: 'SELECT key FROM sys_file WHERE id = $1',
		params: [nativeId('sys_file', file.id)]
	});
	if (Option.isNone(stored)) throw new Error('The template must have its stored XLSX file.');
	const bytes = t.fakes.files.blobs.get(stored.value.key);
	if (bytes === undefined) throw new Error('The template must have its actual XLSX bytes.');
	const book = new ExcelJS.Workbook();
	yield* Effect.tryPromise({
		try: () => book.xlsx.load(Uint8Array.from(bytes).buffer),
		catch: (cause) => new WorkbookIoFailed({ message: String(cause) })
	});
	const sheet = book.worksheets[0];
	if (sheet === undefined) throw new Error('The template must have its worksheet.');
	const cells: Cell[][] = [];
	sheet.eachRow({ includeEmpty: false }, (row) => {
		const values = Array.isArray(row.values) ? row.values.slice(1) : [];
		cells.push(
			values.map((value) =>
				Schema.is(Schema.Union([Schema.Number, Schema.String]))(value) ? value : null
			)
		);
	});
	return cells;
});

it.live(
	'native XLSX clocks preserve zero, blank, Excel numbers and precise dated attendance through the template',
	() =>
		world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const context = { from: MONTH.from, to: PlainDate('2026-03-09') };
				const cells = [
					HEADER,
					clockCells('2026-03-01', '00:00', '00:00'),
					clockCells('2026-03-02', '2026-03-01 23:30:00', '2026-03-02 08:30:00'),
					clockCells('2026-03-03', null, null),
					clockCells('2026-03-04', 9 / 24, 17 / 24),
					clockCells(
						'2026-03-05',
						excelSerial('2026-03-04T23:30:00'),
						excelSerial('2026-03-05T08:30:00')
					),
					clockCells('2026-03-06', '09:00:17', '17:00:43'),
					clockCells('2026-03-07', '2026-03-06T23:30:15+08:00', '2026-03-07T08:30:45+08:00'),
					clockCells('2026-03-08', 0, 0),
					clockCells('2026-03-09', 1, 1 / 24)
				];
				expect(yield* importWorkbook(t, cells, true, context)).toMatchObject({
					applied: true,
					created: 9,
					updated: 0,
					deleted: 0
				});
				const before = yield* storedRoster(t);
				const byDate = new Map(before.map((row) => [row.work_date, row]));
				const intervalsOn = (date: PlainDate) => {
					const row = byDate.get(date);
					assert.ok(row);
					return row.worked_intervals;
				};
				assert.deepEqual(intervalsOn(PlainDate('2026-03-01')), []);
				assert.equal(intervalsOn(PlainDate('2026-03-03')), null);
				assert.deepEqual(intervalsOn(PlainDate('2026-03-08')), []);
				assert.deepEqual(intervalsOn(PlainDate('2026-03-09')), [
					{ start: '2026-03-08T16:00:00.000Z', end: '2026-03-08T17:00:00.000Z' }
				]);
				assert.deepEqual(intervalsOn(PlainDate('2026-03-02')), [
					{
						start: '2026-03-01T15:30:00.000Z',
						end: '2026-03-02T00:30:00.000Z'
					}
				]);
				assert.deepEqual(intervalsOn(PlainDate('2026-03-04')), [
					{
						start: '2026-03-04T01:00:00.000Z',
						end: '2026-03-04T09:00:00.000Z'
					}
				]);
				assert.deepEqual(intervalsOn(PlainDate('2026-03-05')), [
					{
						start: '2026-03-04T15:30:00.000Z',
						end: '2026-03-05T00:30:00.000Z'
					}
				]);
				assert.deepEqual(intervalsOn(PlainDate('2026-03-06')), [
					{
						start: '2026-03-06T01:00:17.000Z',
						end: '2026-03-06T09:00:43.000Z'
					}
				]);
				assert.deepEqual(intervalsOn(PlainDate('2026-03-07')), [
					{
						start: '2026-03-06T15:30:15.000Z',
						end: '2026-03-07T00:30:45.000Z'
					}
				]);
				const previousDate = intervalsOn(PlainDate('2026-03-02'))?.[0];
				assert.ok(previousDate?.end);
				assert.equal(
					(Date.parse(previousDate.end) - Date.parse(previousDate.start)) / 3_600_000,
					9
				);
				const template = yield* templateCells(t, context);
				assert.deepEqual(template[0]?.slice(0, HEADER.length), HEADER);
				assert.equal(template[0]?.[10], 'Planned OT hours');
				assert.equal(template[0]?.at(-1), 'Approved OT 2 break minutes');
				const clockOn = (date: string) => {
					const row = template.find(
						(cellsOfRow) => cellsOfRow[0] === 'WORK-1' && cellsOfRow[1] === date
					);
					assert.ok(row);
					return [row[3] ?? null, row[4] ?? null];
				};
				assert.deepEqual(clockOn('2026-03-01'), ['00:00', '00:00']);
				assert.deepEqual(clockOn('2026-03-03'), [null, null]);
				assert.deepEqual(clockOn('2026-03-08'), ['00:00', '00:00']);
				assert.match(String(clockOn('2026-03-02')[0]), /2026-03-01/);
				assert.match(String(clockOn('2026-03-06')[0]), /:00:17/);
				assert.match(String(clockOn('2026-03-06')[1]), /:00:43/);
				expect(yield* importWorkbook(t, template, true, context)).toMatchObject({
					applied: true,
					created: 0,
					updated: 0,
					deleted: 0
				});
				assert.deepEqual(yield* storedRoster(t), before);
				yield* t
					.as(t.admin)
					.act('payroll_run.create', { company_id: COMPANY, period: '2026-03', kind: 'REGULAR' });
				yield* t.runDue();
				const captured = yield* storedRoster(t);
				expect(yield* importWorkbook(t, template, true, context)).toMatchObject({
					applied: true,
					created: 0,
					updated: 0,
					deleted: 0
				});
				const dateChanged = template.map((row) =>
					row[0] === 'WORK-1' && row[1] === '2026-03-02'
						? clockCells('2026-03-02', '2026-03-02 23:30:00', '2026-03-03 08:30:00')
						: row
				);
				const refused = yield* importWorkbook(t, dateChanged, true, context);
				assert.equal(refused.applied, false);
				assert.ok(
					refused.findings.some(
						(finding) =>
							finding.severity === 'refuse' && /paid|payroll|settled/i.test(finding.message)
					)
				);
				assert.deepEqual(yield* storedRoster(t), captured);
			})
		),
	{ timeout: 15_000 }
);

it.live(
	'equal nonzero or non-forward explicitly dated XLSX clocks refuse without changing stored attendance',
	() =>
		world(tables()).withRead(() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				expect(yield* importWorkbook(t, [HEADER, sheetRow('2026-03-01')], true)).toMatchObject({
					applied: true,
					created: 1
				});
				const before = yield* storedRoster(t);
				const pairs: readonly (readonly [Cell, Cell])[] = [
					['09:30', '09:30'],
					['09:30:15', '09:30:15'],
					[0.5, 0.5],
					['2026-03-02 09:00:00', '2026-03-02 09:00:00'],
					['2026-03-02 09:00:00', '2026-03-02 08:00:00'],
					['2026-03-02T09:00:00+08:00', '2026-03-02T08:00:00+08:00'],
					[excelSerial('2026-03-02T09:00:00'), excelSerial('2026-03-02T08:00:00')]
				];
				for (const [clockIn, clockOut] of pairs) {
					const result = yield* importWorkbook(
						t,
						[HEADER, clockCells('2026-03-02', clockIn, clockOut)],
						true
					);
					assert.equal(result.applied, false, JSON.stringify({ clockIn, clockOut, result }));
					assert.ok(result.findings.some((finding) => finding.severity === 'refuse'));
					assert.deepEqual(yield* storedRoster(t), before);
				}
			})
		),
	{ timeout: 15_000 }
);
