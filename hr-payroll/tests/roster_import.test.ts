/**
 * The `roster_entry` pipeline's hooks (known → map → related → check) over an xlsx written here, against fixture
 * rows: what each row maps to, the leave it records once, settled days, blanks, a holiday and a leaver's tail, and a
 * configured `roster` validation as a warning or a refusal. The scope's deletes and the xlsx decode are Bolt's (the
 * e2e suite runs them for real).
 */
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { PlainDate } from '@norbital-ai/std/date';
import { assertFailure, world } from './jurisdiction_kit.ts';
import { fixtureId, nativeId } from './fixture_values.ts';
import ExcelJS from 'exceljs';
import { Effect } from 'effect';
import { Refusal } from '../src/lib/payroll_engine/foundation.ts';
import { planRosterImport, rosterSheet } from '../src/lib/payroll_engine/roster_import.ts';
import { SHEET_COLUMNS, isField } from '../src/lib/payroll_engine/roster_sheet.ts';

type Row = Record<string, unknown>;
const ZONE = 'Asia/Singapore';
const COMPANY = nativeId('entity', fixtureId('c1'));
const VERSION = nativeId('jurisdiction_settings', fixtureId('v1'));
const contract = (id: string, number: string, to: string | null = null): Row => ({
	id: fixtureId(id),
	company_id: COMPANY,
	employee_id: fixtureId(`p-${id}`),
	employee_number: number,
	contract_number: 1,
	effective_range: { from: '2025-01-01', to },
	facts: {}
});
const entry = (id: string, employment_id: string, work_date: string, extra: Row = {}): Row => ({
	id: fixtureId(id),
	employment_id: nativeId('employment_contract', fixtureId(employment_id)),
	work_date,
	shift_definition_id: nativeId('shift_definition', fixtureId('D')),
	worked_intervals: null,
	...extra
});

const fixture = (
	overrides: {
		rules?: Row[];
		payslips?: Row[];
		runs?: Row[];
		leave?: Row[];
		entries?: Row[];
		/** The zone on the version instead of the entity. */
		versionZone?: boolean;
	} = {}
) => {
	const tables = new Map<string, Row[]>([
		[
			'entity',
			[
				{
					id: COMPANY,
					name: 'Acme',
					settings_code: 'XX',
					pay_cutoff_day: 1,
					effective_range: { from: '2025-01-01', to: null },
					time_zone: overrides.versionZone === true ? null : ZONE,
					facts: {}
				}
			]
		],
		[
			'jurisdiction_settings',
			[
				{
					id: VERSION,
					code: 'XX',
					jurisdiction_code: 'XX',
					name: 'Fixture jurisdiction',
					sources: {
						entries: [],
						instructions: 'Synthetic roster planning fixture; no jurisdiction law is asserted.'
					},
					effective_range: { from: '2026-01-01', to: null },
					sealed_at: '2026-01-01T00:00:00.000Z',
					voided_at: null,
					payroll: overrides.versionZone === true ? { timezone: ZONE } : {}
				}
			]
		],
		['employment_contract', [contract('k1', 'E1'), contract('k2', 'E2', '2026-03-10')]],
		[
			'employment_profile',
			[
				{ id: nativeId('employment_profile', fixtureId('p-k1')), name: 'Ann' },
				{ id: nativeId('employment_profile', fixtureId('p-k2')), name: 'Ben' }
			]
		],
		[
			'shift_definition',
			[
				{
					id: nativeId('shift_definition', fixtureId('D')),
					company_id: COMPANY,
					code: 'D',
					variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00' }
				},
				{
					id: nativeId('shift_definition', fixtureId('R')),
					company_id: COMPANY,
					code: 'R',
					variant: { day_type: 'REST' }
				}
			]
		],
		['shift_pattern', []],
		[
			'holiday',
			[
				{
					id: nativeId('holiday', fixtureId('h1')),
					company_id: COMPANY,
					date: '2026-03-09',
					name: 'Founders Day',
					kind: 'PUBLIC_HOLIDAY',
					published_at: '2026-01-01T00:00:00.000Z'
				}
			]
		],
		[
			'roster_entry',
			[
				entry('e1', nativeId('employment_contract', fixtureId('k1')), '2026-03-02', {
					worked_intervals: [{ start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T10:00:00.000Z' }]
				}),
				entry('e2', nativeId('employment_contract', fixtureId('k1')), '2026-03-03'),
				entry('e3', nativeId('employment_contract', fixtureId('k1')), '2026-03-04', {
					overtime_consented_at: '2026-03-02T09:00:00.000Z'
				}),
				entry('e4', nativeId('employment_contract', fixtureId('k1')), '2026-03-06', {
					payslip_id: nativeId('payslip', fixtureId('p1'))
				}),
				entry('e5', nativeId('employment_contract', fixtureId('k2')), '2026-03-05'),
				entry('e6', nativeId('employment_contract', fixtureId('k1')), '2026-03-08')
			].map((row) => overrides.entries?.find((over) => over.id === row.id) ?? row)
		],
		[
			'leave_catalog',
			[
				{
					id: nativeId('leave_catalog', fixtureId('AL1')),
					settings_id: VERSION,
					code: 'AL',
					name: 'Annual leave',
					can_encash: true
				}
			]
		],
		[
			'leave_catalog_entry',
			[
				{
					id: fixtureId('sheet-leave-1'),
					company_id: COMPANY,
					employment_id: nativeId('employment_contract', fixtureId('k1')),
					catalog_id: nativeId('leave_catalog', fixtureId('AL1')),
					activity: 'TIME_OFF',
					occurred_on: '2026-03-08',
					days: 1,
					from: '2026-03-08',
					to: '2026-03-08'
				},
				...(overrides.leave ?? [])
			]
		],
		[
			'payslip',
			[
				{
					id: nativeId('payslip', fixtureId('p1')),
					payroll_run_id: fixtureId('pinned-run'),
					employment_id: nativeId('employment_contract', fixtureId('k1')),
					terms_through: '2026-03-06',
					currency: 'SGD',
					gross: 0,
					total_deductions: 0,
					net: 0,
					employer_cost: 0,
					status: 'PAID'
				},
				...(overrides.payslips ?? [])
			]
		],
		[
			'payroll_run',
			[
				{
					id: fixtureId('pinned-run'),
					company_id: COMPANY,
					settings_id: VERSION,
					period: '2026-03',
					kind: 'REGULAR'
				},
				...(overrides.runs ?? [])
			]
		],
		['rule_set', overrides.rules ?? []]
	]);
	return tables;
};

/** The sheet as HR fills it: header row, then the cells by column. */
const FILLED: (string | number)[][] = [
	['E1', '2026-03-02', 'D', '09:00', '18:00'],
	['E1', '2026-03-04', 'D', '08:00', '20:00'],
	['E1', '2026-03-05', 'D', '22:00', '06:00'],
	['E1', '2026-03-06', 'D'],
	['E1', '2026-03-07', '', '', '', '', '', 'AL'],
	['E1', '2026-03-09'],
	['E2', '2026-03-05'],
	['E2', '2026-03-11'],
	['E1', '2026-03-08', 'D', '', '', '', '', 'AL']
];
/** The sheet as a file, read back by header as the pipeline reads it: one record per row, blank cells absent. */
const xlsx = Effect.fnUntraced(function* (rows: readonly (readonly (string | number)[])[]) {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Work days');
	sheet.addRow(Object.values(SHEET_COLUMNS));
	for (const row of rows) sheet.addRow([...row]);
	const read = new ExcelJS.Workbook();
	const bytes = yield* Effect.tryPromise({
		try: () => workbook.xlsx.writeBuffer(),
		catch: (cause) =>
			new Refusal({ message: `The fixture workbook could not be written: ${String(cause)}` })
	});
	yield* Effect.tryPromise({
		try: () => read.xlsx.load(bytes),
		catch: (cause) =>
			new Refusal({ message: `The fixture workbook could not be read: ${String(cause)}` })
	});
	const fields = Object.keys(SHEET_COLUMNS).filter(isField);
	const out: ({ row: number } & Record<string, string | number>)[] = [];
	const first = read.worksheets[0];
	assert.ok(first);
	first.eachRow((line, index) => {
		if (index === 1) return;
		const cells: Record<string, string | number> = {};
		fields.forEach((field, column) => {
			const value = line.getCell(column + 1).value;
			if (typeof value === 'number' || (typeof value === 'string' && value !== ''))
				cells[field] = value;
		});
		out.push({ row: index, ...cells });
	});
	return out;
});
const plan = (rows: Effect.Success<ReturnType<typeof xlsx>>, source = fixture()) =>
	world(source).withRead((read) => planRosterImport({ company_id: COMPANY, rows }, read));
const template = (context: { from: string; to: string }, today: string, source = fixture()) =>
	world(source).withRead((read) =>
		rosterSheet(
			{ company_id: COMPANY, from: PlainDate(context.from), to: PlainDate(context.to) },
			today,
			read
		)
	);
const at = (result: Effect.Success<ReturnType<typeof plan>>, date: string) =>
	result.rows.find(
		(row) =>
			row != null &&
			String(row.work_date) === date &&
			row.employment_id === nativeId('employment_contract', fixtureId('k1'))
	);
const overtimeRule = (kind: string): Row => ({
	id: fixtureId(`overtime-rule:${kind}`),
	settings_id: VERSION,
	name: 'Overtime daily',
	family: 'VALIDATIONS',
	code: 'OVERTIME_DAILY',
	rules: {
		site: 'roster',
		kind,
		column: 'clock_out',
		when: 'day.overtime_hours > 1.5',
		message: 'more than 1.5 overtime hours in a day'
	}
});

describe('work-day sheet import', () => {
	it.effect(
		'maps each row onto its day: kept intervals, overtime, an overnight clock; blanks, holidays and a leaver map to nothing',
		Effect.fnUntraced(function* () {
			const result = yield* plan(yield* xlsx(FILLED));
			assert.deepEqual(result.errors, []);
			// the stored 09:00–18:00 day restates its own intervals
			assert.deepEqual(at(result, '2026-03-02')?.worked_intervals, [
				{ start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T10:00:00.000Z' }
			]);
			assert.equal(Object.hasOwn(SHEET_COLUMNS, 'overtime_hours'), false);
			assert.equal(at(result, '2026-03-04')?.worked_intervals?.length, 1);
			assert.equal(Object.hasOwn(SHEET_COLUMNS, 'incentive_hours'), false);
			assert.equal(Object.hasOwn(at(result, '2026-03-04') ?? {}, 'incentive_hours'), false);
			assert.deepEqual(
				(at(result, '2026-03-05')?.worked_intervals ?? []).map((row) => [
					String(row.start),
					String(row.end)
				]),
				[['2026-03-05T14:00:00.000Z', '2026-03-05T22:00:00.000Z']]
			);
			// the pinned day and the day on recorded leave restate their planned shift; the holiday is blank
			assert.equal(at(result, '2026-03-06')?.shift_definition_id, fixtureId('D'));
			assert.equal(at(result, '2026-03-08')?.shift_definition_id, fixtureId('D'));
			assert.equal(at(result, '2026-03-09'), undefined);
			assert.equal(at(result, '2026-03-07'), undefined);
			// E2 maps nothing: a blank day (the scope cannot reach it, so it warns) and a day after the exit
			assert.ok(
				result.rows.every(
					(row) =>
						row == null || row.employment_id === nativeId('employment_contract', fixtureId('k1'))
				)
			);
			assert.deepEqual(
				result.warnings.map((finding) => finding.row),
				[8]
			);
			// 03-07's AL is recorded once; 03-08's AL is already on file
			assert.equal(result.leave.length, 1);
			assert.equal(result.leave[0]!.catalog_id, nativeId('leave_catalog', fixtureId('AL1')));
			assert.equal(String(result.leave[0]!.from), '2026-03-07');
			const again = yield* plan(
				yield* xlsx(FILLED),
				fixture({
					leave: [
						{
							id: fixtureId('sheet-leave-2'),
							company_id: COMPANY,
							employment_id: nativeId('employment_contract', fixtureId('k1')),
							catalog_id: nativeId('leave_catalog', fixtureId('AL1')),
							activity: 'TIME_OFF',
							occurred_on: '2026-03-07',
							days: 1,
							from: '2026-03-07',
							to: '2026-03-07'
						}
					]
				})
			);
			assert.equal(again.leave.length, 0);
		})
	);

	it.effect(
		'a hook without a fallback rejects with the refusal: a failed template download says why',
		Effect.fnUntraced(function* () {
			yield* assertFailure(
				Effect.fail(new Refusal({ message: 'No sealed XX version governs 2026-03-01.' })),
				/No sealed XX version governs/
			);
			assert.deepEqual(
				yield* Effect.fail(new Refusal({ message: 'x' })).pipe(
					Effect.catchTag('Refusal', (failure) => Effect.succeed([failure.message]))
				),
				['x']
			);
		})
	);

	it.effect(
		'an entity without a zone counts clocks in its governing version’s payroll.timezone, import and template alike',
		Effect.fnUntraced(function* () {
			const read = fixture({ versionZone: true });
			const result = yield* plan(yield* xlsx([['E1', '2026-03-03', 'D', '09:00', '18:00']]), read);
			assert.deepEqual(result.errors, []);
			assert.deepEqual(
				(at(result, '2026-03-03')?.worked_intervals ?? []).map((row) => [
					String(row.start),
					String(row.end)
				]),
				[['2026-03-03T01:00:00.000Z', '2026-03-03T10:00:00.000Z']]
			);
			const sheet = yield* template({ from: '2026-03-02', to: '2026-03-02' }, '2026-03-02', read);
			assert.deepEqual(
				sheet
					.filter((row) => row.employee_number === 'E1')
					.map((row) => [row.clock_in, row.clock_out]),
				[['09:00', '18:00']]
			);
		})
	);

	it.effect(
		'refuses a change to a settled day, naming its row, and a settled day the scope would delete',
		Effect.fnUntraced(function* () {
			const changed = FILLED.map((row) =>
				row[1] === '2026-03-06' ? ['E1', '2026-03-06', 'D', '09:00', '17:00'] : row
			);
			const pinned = yield* plan(yield* xlsx(changed));
			assert.equal(pinned.errors.length, 1);
			assert.equal(pinned.errors[0]!.row, 5);
			assert.match(pinned.errors[0]!.message, /settled on a payslip/);
			// a day on recorded leave keeps its planned shift, but takes no clock
			const onLeave = yield* plan(
				yield* xlsx(
					FILLED.map((row) =>
						row[1] === '2026-03-08' ? ['E1', '2026-03-08', 'D', '09:00', '18:00'] : row
					)
				)
			);
			assert.deepEqual(
				onLeave.errors.map((finding) => [finding.row, finding.column]),
				[[10, SHEET_COLUMNS.leave_code]]
			);
			// a regular run's attendance window settles 03-03 without a pin: leaving it out would delete it
			const paid = yield* plan(
				yield* xlsx(FILLED),
				fixture({
					payslips: [
						{
							id: fixtureId('settled-window-slip'),
							employment_id: nativeId('employment_contract', fixtureId('k1')),
							payroll_run_id: nativeId('payroll_run', fixtureId('r1')),
							terms_through: '2026-03-03',
							currency: 'SGD',
							gross: 0,
							total_deductions: 0,
							net: 0,
							employer_cost: 0,
							status: 'PAID'
						}
					],
					runs: [
						{
							id: nativeId('payroll_run', fixtureId('r1')),
							company_id: COMPANY,
							settings_id: VERSION,
							period: '2026-03',
							kind: 'REGULAR',
							attendance_from: '2026-03-03',
							attendance_to: '2026-03-03'
						}
					]
				})
			);
			assert.deepEqual(
				paid.errors.map((finding) => finding.row),
				[null]
			);
			assert.match(paid.errors[0]!.message, /E1 2026-03-03 is inside a period already paid/);
		})
	);

	it.effect(
		'blocks on structure whatever the rules say: unknown employee, a leaver with values, a repeat, an unknown shift, half a clock',
		Effect.fnUntraced(function* () {
			const result = yield* plan(
				yield* xlsx([
					['E9', '2026-03-02'],
					['E2', '2026-03-12', 'D'],
					['E1', '2026-03-02', 'D'],
					['E1', '2026-03-02', 'D'],
					['E1', '2026-03-03', 'X'],
					['E1', '2026-03-04', 'D', '09:00']
				])
			);
			assert.deepEqual(
				result.errors.map((finding) => [finding.row, finding.column]),
				[
					[2, SHEET_COLUMNS.employee_number],
					[3, SHEET_COLUMNS.work_date],
					[5, SHEET_COLUMNS.work_date],
					[6, SHEET_COLUMNS.shift_code],
					[7, SHEET_COLUMNS.clock_out]
				]
			);
		})
	);

	it.effect(
		"OT consent is the day's own: marked or dated sets it, a restatement keeps it, blank clears it, a settled day keeps it",
		Effect.fnUntraced(function* () {
			// 2026-03-04 holds consent given 2026-03-02 17:00 local; 2026-03-05 holds none
			const consent = Effect.fnUntraced(function* (cell: string | number, date = '2026-03-04') {
				const result = yield* plan(
					yield* xlsx(
						FILLED.map((row) => (row[1] === date ? ['E1', date, 'D', '08:00', '20:00', cell] : row))
					)
				);
				return (
					result.rows.find((row) => row !== null && String(row.work_date) === date)
						?.overtime_consented_at ?? null
				);
			});

			// marked: a new consent is the work day's local start; a restated one keeps its instant
			assert.equal(String(yield* consent('Y', '2026-03-05')), '2026-03-04T16:00:00.000Z');
			for (const mark of ['Y', 'yes', 'TRUE', 1, '2026-03-02'])
				assert.equal(String(yield* consent(mark)), '2026-03-02T09:00:00.000Z', String(mark));
			// a date: that day's local start, typed or as an Excel date serial (46082 = 2026-03-01)
			assert.equal(String(yield* consent('2026-03-04')), '2026-03-03T16:00:00.000Z');
			assert.equal(String(yield* consent(46082)), '2026-02-28T16:00:00.000Z');
			// blank: the restated day carries none (the set clears the stored consent); no consent is derived from overtime
			assert.equal(at(yield* plan(yield* xlsx(FILLED)), '2026-03-04')?.overtime_consented_at, null);
			const refused = yield* plan(
				yield* xlsx(
					FILLED.map((row) =>
						row[1] === '2026-03-04' ? ['E1', '2026-03-04', 'D', '08:00', '20:00', 'maybe'] : row
					)
				)
			);
			assert.deepEqual(
				refused.errors.map((finding) => [finding.row, finding.column]),
				[[3, SHEET_COLUMNS.overtime_consent]]
			);
			// locked: a pinned day restating its consent passes; marking or clearing it refuses
			const pinned = fixture({
				entries: [
					entry('e4', nativeId('employment_contract', fixtureId('k1')), '2026-03-06', {
						payslip_id: nativeId('payslip', fixtureId('p1')),
						overtime_consented_at: '2026-03-05T02:00:00.000Z'
					})
				]
			});
			const onPinned = Effect.fnUntraced(function* (cell: string) {
				return yield* plan(
					yield* xlsx(
						FILLED.map((row) =>
							row[1] === '2026-03-06' ? ['E1', '2026-03-06', 'D', '', '', cell] : row
						)
					),
					pinned
				);
			});

			assert.deepEqual((yield* onPinned('Y')).errors, []);
			assert.deepEqual(
				(yield* onPinned('')).errors.map((finding) => [finding.row, finding.message]),
				[[5, 'E1 2026-03-06 is settled on a payslip and cannot change.']]
			);
			const marked = yield* plan(
				yield* xlsx(
					FILLED.map((row) =>
						row[1] === '2026-03-06' ? ['E1', '2026-03-06', 'D', '', '', 'Y'] : row
					)
				)
			);
			assert.match(marked.errors[0]!.message, /settled on a payslip/);
			// the template prefills the stored consent as its local day, which re-imports unchanged
			const sheet = yield* template(
				{ from: '2026-03-04', to: '2026-03-05' },
				'2026-03-10',
				fixture()
			);
			assert.deepEqual(
				sheet
					.filter((row) => row.employee_number === 'E1')
					.map((row) => [row.work_date, row.overtime_consent]),
				[
					['2026-03-04', '2026-03-02'],
					['2026-03-05', null]
				]
			);
		})
	);

	it.effect(
		'a configured roster rule warns or refuses as its kind says',
		Effect.fnUntraced(function* () {
			const warned = yield* plan(yield* xlsx(FILLED), fixture({ rules: [overtimeRule('warn')] }));
			assert.deepEqual(warned.errors, []);
			assert.deepEqual(
				warned.warnings.filter((finding) => finding.row === 3),
				[
					{
						row: 3,
						column: SHEET_COLUMNS.clock_out,
						message: 'more than 1.5 overtime hours in a day'
					}
				]
			);
			const refused = yield* plan(
				yield* xlsx(FILLED),
				fixture({ rules: [overtimeRule('refuse')] })
			);
			assert.deepEqual(
				refused.errors.map((finding) => finding.row),
				[3]
			);
		})
	);
});
