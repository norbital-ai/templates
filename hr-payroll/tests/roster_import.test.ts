/**
 * `planRosterImport` over in-memory sheet rows against one seeded fixture: what each row maps to, structural refusals
 * (an unknown shift code among them), settled days, approved OT windows, OT consent and a configured `roster` rule.
 */
import assert from 'node:assert/strict';
import { layer, it } from '@effect/vitest';
import { vi } from 'vitest';
import { TestWorkspace } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { csvRows } from '@norbital-ai/std/csv';
import { PlainDate } from '@norbital-ai/std/date';
import { PAYROLL, world } from './jurisdiction_kit.ts';
import { fixtureId, nativeId } from './fixture_values.ts';
import { planRosterImport } from '../src/lib/payroll_engine/roster_import.ts';
import { SHEET_COLUMNS, isField, type SheetField } from '../src/lib/payroll_engine/roster_sheet.ts';
import { consumedLeaveCovers } from '../src/lib/payroll_engine/leave.ts';

type Row = Record<string, unknown>;
const ZONE = 'Asia/Singapore';
const COMPANY = nativeId('entity', fixtureId('c1'));
const VERSION = nativeId('jurisdiction_settings', fixtureId('v1'));
const K1 = nativeId('employment_contract', fixtureId('k1'));
const contract = (id: string, number: string, to: string | null = null): Row => ({
	id: fixtureId(id),
	company_id: COMPANY,
	employee_id: fixtureId(`p-${id}`),
	employee_number: number,
	contract_number: 1,
	effective_range: { from: '2025-01-01', to },
	facts: {}
});
const entry = (id: string, work_date: string, extra: Row = {}): Row => ({
	id: fixtureId(id),
	employment_id: K1,
	work_date,
	shift_definition_id: nativeId('shift_definition', fixtureId('D')),
	worked_intervals: null,
	...extra
});

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
				time_zone: ZONE,
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
				name: 'Fixture jurisdiction',
				sources: { entries: [], instructions: 'Synthetic roster planning fixture.' },
				effective_range: { from: '2026-01-01', to: null },
				sealed_at: '2026-01-01T00:00:00.000Z',
				voided_at: null,
				payroll: { attendance: PAYROLL.attendance, monthly_wage: PAYROLL.monthly_wage }
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
			entry('e1', '2026-03-02', {
				worked_intervals: [{ start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T10:00:00.000Z' }]
			}),
			entry('e2', '2026-03-03'),
			entry('e3', '2026-03-04', { overtime_consented_at: '2026-03-02T09:00:00.000Z' }),
			entry('e4', '2026-03-06', { payslip_id: nativeId('payslip', fixtureId('p1')) }),
			{
				...entry('e5', '2026-03-05'),
				employment_id: nativeId('employment_contract', fixtureId('k2'))
			},
			entry('e6', '2026-03-08')
		]
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
			},
			{
				id: nativeId('leave_catalog', fixtureId('UL1')),
				settings_id: VERSION,
				code: 'UL',
				name: 'Unpaid leave',
				can_encash: false
			}
		]
	],
	[
		'leave_catalog_entry',
		[
			{
				id: fixtureId('sheet-leave-1'),
				company_id: COMPANY,
				employment_id: K1,
				catalog_id: nativeId('leave_catalog', fixtureId('AL1')),
				activity: 'TIME_OFF',
				occurred_on: '2026-03-08',
				days: 1,
				from: '2026-03-08',
				to: '2026-03-08'
			},
			// two half days on one day: annual leave in the morning, unpaid leave in the afternoon
			{
				id: fixtureId('sheet-leave-am'),
				company_id: COMPANY,
				employment_id: K1,
				catalog_id: nativeId('leave_catalog', fixtureId('AL1')),
				activity: 'TIME_OFF',
				occurred_on: '2026-03-31',
				days: 0.5,
				from: '2026-03-31',
				to: '2026-03-31',
				half_day_end: true
			},
			{
				id: fixtureId('sheet-leave-pm'),
				company_id: COMPANY,
				employment_id: K1,
				catalog_id: nativeId('leave_catalog', fixtureId('UL1')),
				activity: 'TIME_OFF',
				occurred_on: '2026-03-31',
				days: 0.5,
				from: '2026-03-31',
				to: '2026-03-31',
				half_day_start: true
			}
		]
	],
	[
		'payslip',
		[
			{
				id: nativeId('payslip', fixtureId('p1')),
				payroll_run_id: fixtureId('pinned-run'),
				employment_id: K1,
				terms_through: '2026-03-06',
				currency: 'SGD',
				gross: 0,
				total_deductions: 0,
				net: 0,
				employer_cost: 0,
				status: 'PAID'
			}
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
			}
		]
	],
	[
		'rule_set',
		[
			{
				id: fixtureId('overtime-rule'),
				settings_id: VERSION,
				name: 'Overtime daily',
				family: 'VALIDATIONS',
				code: 'OVERTIME_DAILY',
				rules: {
					site: 'roster',
					kind: 'warn',
					column: 'clock_out',
					when: 'day.overtime_hours > 1.5',
					message: 'more than 1.5 overtime hours in a day'
				}
			}
		]
	]
]);

type Cells = { row: number } & Partial<Record<SheetField, string | number>>;
const FIELDS = Object.keys(SHEET_COLUMNS).filter(isField);
/** Positional cells in sheet column order, numbered from row 2 as under a header; blank cells absent. */
const sheet = (rows: readonly (readonly (string | number)[])[]): Cells[] =>
	rows.map((cells, index) => {
		const record: Cells = { row: index + 2 };
		cells.forEach((value, column) => {
			const field = FIELDS[column];
			if (field !== undefined && value !== '') record[field] = value;
		});
		return record;
	});
const FILLED = [
	['E1', '2026-03-02', 'D', '09:00', '18:00'],
	['E1', '2026-03-04', 'D', '08:00', '20:00'],
	['E1', '2026-03-05', 'D', '22:00', '06:00'],
	['E1', '2026-03-06', 'D'],
	['E1', '2026-03-07'],
	['E1', '2026-03-09'],
	['E2', '2026-03-05'],
	['E2', '2026-03-11'],
	['E1', '2026-03-08', 'D']
] as const;
const replace = (date: string, cells: readonly (string | number)[]) =>
	FILLED.map((row) => (row[1] === date ? cells : row));

const plan = Effect.fnUntraced(function* (rows: readonly Cells[]) {
	const t = yield* TestWorkspace;
	return yield* planRosterImport({ company_id: COMPANY, rows }, t.as(t.admin).query);
});
const at = (result: Effect.Success<ReturnType<typeof plan>>, date: string) =>
	result.rows.find(
		(row) => row != null && String(row.work_date) === date && row.employment_id === K1
	);

it('a day under leave a payslip consumed is locked', () => {
	const consumed = {
		id: fixtureId('consumed-leave'),
		company_id: COMPANY,
		employment_id: K1,
		catalog_id: nativeId('leave_catalog', fixtureId('AL1')),
		activity: 'TIME_OFF',
		occurred_on: '2026-03-03',
		days: 1,
		from: '2026-03-03',
		to: '2026-03-03',
		payslip_id: nativeId('payslip', fixtureId('p1'))
	};
	assert.equal(consumedLeaveCovers([consumed], K1, '2026-03-03'), true);
	assert.equal(consumedLeaveCovers([consumed], K1, '2026-03-04'), false);
	assert.equal(consumedLeaveCovers([{ ...consumed, payslip_id: null }], K1, '2026-03-03'), false);
});

layer(world(tables).layer)('work-day sheet import', (it) => {
	it.effect(
		'maps each row onto its day; blanks, holidays and a leaver map to nothing; a roster rule warns',
		Effect.fnUntraced(function* () {
			const result = yield* plan(sheet(FILLED));
			assert.deepEqual(result.errors, []);
			assert.deepEqual(at(result, '2026-03-02')?.worked_intervals, [
				{ start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T10:00:00.000Z' }
			]);
			assert.deepEqual(
				(at(result, '2026-03-05')?.worked_intervals ?? []).map((row) => [
					String(row.start),
					String(row.end)
				]),
				[['2026-03-05T14:00:00.000Z', '2026-03-05T22:00:00.000Z']]
			);
			assert.equal(at(result, '2026-03-06')?.shift_definition_id, fixtureId('D'));
			assert.equal(at(result, '2026-03-09'), undefined);
			assert.equal(at(result, '2026-03-07'), undefined);
			assert.ok(result.rows.every((row) => row == null || row.employment_id === K1));
			assert.deepEqual(result.warnings.map((finding) => finding.row).toSorted(), [3, 8]);
		})
	);

	it.effect(
		'parses each clock cell once per upload: zone conversions grow by a small constant per clocked row',
		Effect.fnUntraced(function* () {
			const days = Array.from(
				{ length: 20 },
				(_, i) => `2026-03-${String(i + 10).padStart(2, '0')}`
			);
			const conversions = Effect.fnUntraced(function* (rows: number, start: string, end: string) {
				const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
				const result = yield* plan(
					sheet(days.slice(0, rows).map((day) => ['E1', day, 'D', start, end]))
				);
				const calls = spy.mock.calls.length;
				spy.mockRestore();
				assert.deepEqual(result.errors, []);
				return calls;
			});
			// fresh clock values per plan: nothing parsed by the first is reused by the second
			const ten = yield* conversions(10, '09:00', '18:00'),
				twenty = yield* conversions(20, '08:00', '17:00');
			// mapping, validation and the day's roster checks each read a row's clock; parsed once, a row adds a handful (24 when
			// every read reparsed it). The count varies a little by host zone (6 locally, 11 on a UTC runner): the bound is half of 24
			assert.ok(
				(twenty - ten) / 10 <= 12,
				`${(twenty - ten) / 10} zone conversions per clocked row`
			);
		})
	);

	it.effect(
		'blocks on structure: unknown employee, a leaver with values, a repeat, an unknown shift, half a clock',
		Effect.fnUntraced(function* () {
			const result = yield* plan(
				sheet([
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
		'refuses a change to a settled day and a clock on a day of recorded leave, naming the row',
		Effect.fnUntraced(function* () {
			const pinned = yield* plan(
				sheet(replace('2026-03-06', ['E1', '2026-03-06', 'D', '09:00', '17:00']))
			);
			assert.deepEqual(
				pinned.errors.map((finding) => finding.row),
				[5]
			);
			assert.match(pinned.errors[0]!.message, /settled on a payslip/);
			const onLeave = yield* plan(
				sheet(replace('2026-03-08', ['E1', '2026-03-08', 'D', '09:00', '18:00']))
			);
			assert.deepEqual(
				onLeave.errors.map((finding) => [finding.row, finding.column]),
				[[10, SHEET_COLUMNS.clock_in]]
			);
		})
	);

	it.effect(
		'imports exact approved OT windows without inventing consent, and refuses malformed windows',
		Effect.fnUntraced(function* () {
			const row = {
				row: 2,
				employee_number: 'E1',
				work_date: '2026-03-03',
				shift_code: 'D',
				planned_overtime_hours: 3.5
			};
			const result = yield* plan([
				{
					...row,
					approved_ot_1_start: '2026-03-03T07:00:17+08:00',
					approved_ot_1_end: '2026-03-03T09:00:00+08:00',
					approved_ot_1_break_minutes: 30
				}
			]);
			assert.deepEqual(result.errors, []);
			assert.deepEqual(at(result, '2026-03-03')?.approved_overtime_intervals, [
				{ start: '2026-03-02T23:00:17.000Z', end: '2026-03-03T01:00:00.000Z', break_minutes: 30 }
			]);
			assert.equal(at(result, '2026-03-03')?.overtime_consented_at, null);
			const start = '2026-03-03T18:00:00+08:00',
				end = '2026-03-03T20:00:00+08:00';
			for (const invalid of [
				{ ...row, approved_ot_1_start: start },
				{ ...row, approved_ot_1_start: end, approved_ot_1_end: start },
				{ ...row, approved_ot_1_start: 'CLEAR', approved_ot_1_end: end },
				{
					...row,
					approved_ot_1_start: start,
					approved_ot_1_end: end,
					approved_ot_1_break_minutes: 120
				}
			])
				assert.equal((yield* plan([invalid])).errors.length, 1);
		})
	);

	it.effect(
		"OT consent is the day's own: a mark or date sets the local day start, a bad value or a settled day refuses",
		Effect.fnUntraced(function* () {
			const consent = Effect.fnUntraced(function* (cell: string | number, date: string) {
				const result = yield* plan(sheet(replace(date, ['E1', date, 'D', '08:00', '20:00', cell])));
				return { result, value: at(result, date)?.overtime_consented_at ?? null };
			});
			assert.equal(String((yield* consent('Y', '2026-03-05')).value), '2026-03-04T16:00:00.000Z');
			assert.equal(String((yield* consent('Y', '2026-03-04')).value), '2026-03-02T09:00:00.000Z');
			assert.equal(String((yield* consent(46082, '2026-03-04')).value), '2026-02-28T16:00:00.000Z');
			assert.deepEqual(
				(yield* consent('maybe', '2026-03-04')).result.errors.map((finding) => [
					finding.row,
					finding.column
				]),
				[[3, SHEET_COLUMNS.overtime_consent]]
			);
			const marked = yield* plan(
				sheet(replace('2026-03-06', ['E1', '2026-03-06', 'D', '', '', 'Y']))
			);
			assert.match(marked.errors[0]!.message, /settled on a payslip/);
		})
	);

	it.effect(
		'PH is no shift code: the row is refused, pointing at the jurisdiction calendar',
		Effect.fnUntraced(function* () {
			const result = yield* plan(sheet(replace('2026-03-06', ['E1', '2026-03-06', 'ph'])));
			assert.deepEqual(
				result.errors.map((finding) => [finding.row, finding.column]),
				[[5, SHEET_COLUMNS.shift_code]]
			);
			assert.match(result.errors[0]!.message, /jurisdiction calendar/);
		})
	);

	it.effect(
		'a Shift value that is no shift in effect for the person and day refuses the file, naming the row and value',
		Effect.fnUntraced(function* () {
			for (const code of ['X', 'AL', 'd ']) {
				const result = yield* plan(sheet(replace('2026-03-02', ['E1', '2026-03-02', code])));
				assert.deepEqual(
					result.errors.map((finding) => [finding.row, finding.column]),
					[[2, SHEET_COLUMNS.shift_code]],
					code
				);
				assert.match(result.errors[0]!.message, new RegExp(`Row 2: "${code.trim()}"`));
			}
			assert.deepEqual(
				(yield* plan(sheet(replace('2026-03-02', ['E1', '2026-03-02', 'R'])))).errors,
				[]
			);
		})
	);

	// the real file sync, last: its imports write to the shared workspace
	it.effect(
		'the work sheet round trip: download → unchanged upload is a no-op; an error writes nothing; warnings come with the import',
		Effect.fnUntraced(function* () {
			const t = yield* TestWorkspace;
			const admin = t.as(t.admin);
			const context = {
				company_id: COMPANY,
				from: PlainDate('2026-03-01'),
				to: PlainDate('2026-03-31')
			};
			const Output = Schema.Struct({
				state: Schema.String,
				output: Schema.NullOr(Schema.Json),
				error: Schema.NullOr(Schema.Json)
			});
			const finished = Effect.fnUntraced(function* (id: string) {
				yield* t.runDue();
				const [run] = yield* t.db.rows(Output, {
					text: 'SELECT state, output, error FROM sys_run WHERE id = $1',
					params: [id]
				});
				assert.equal(run?.state, 'succeeded', JSON.stringify(run?.error));
				return run.output;
			});
			const started = yield* admin.start('roster_entry.sync.work_sheet', {
				mode: 'template',
				format: 'csv',
				context
			});
			assert.equal(started.kind, 'committed');
			if (started.kind !== 'committed') return;
			const { file } = Schema.decodeUnknownSync(
				Schema.Struct({ file: Schema.Struct({ id: Schema.String }) })
			)(yield* finished(started.output.id));
			const [stored] = yield* t.db.rows(Schema.Struct({ key: Schema.String }), {
				text: 'SELECT key FROM sys_file WHERE id = $1',
				params: [file.id]
			});
			const downloaded = new TextDecoder().decode(t.fakes.files.blobs.get(stored!.key));
			const [header = [], ...lines] = csvRows(downloaded.replace(/^\uFEFF/, ''));
			const column = (field: SheetField) => header.indexOf(SHEET_COLUMNS[field]);
			assert.ok(!header.includes('Leave'), 'the sheet has no Leave column');

			const Imported = Schema.Struct({
				applied: Schema.Boolean,
				created: Schema.optionalKey(Schema.Number),
				updated: Schema.optionalKey(Schema.Number),
				deleted: Schema.optionalKey(Schema.Number),
				findings: Schema.Array(
					Schema.Struct({ at: Schema.Number, message: Schema.String, severity: Schema.String })
				)
			});
			const state = () =>
				t.db.rows(Schema.Struct({ rows: Schema.String }), {
					text: `SELECT (SELECT json_agg(r ORDER BY r.id)::text FROM roster_entry r)
						|| (SELECT count(*)::text FROM leave_catalog_entry) AS rows`,
					params: []
				});
			const upload = Effect.fnUntraced(function* (
				rows: readonly (readonly (string | number | null)[])[],
				head: readonly string[] = header
			) {
				const text = [head, ...rows]
					.map((row) =>
						row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')
					)
					.join('\n');
				const ref = yield* admin.upload('roster_entry.$import.work_sheet', {
					name: 'work.csv',
					mime: 'text/csv',
					bytes: new TextEncoder().encode(text)
				});
				assert.equal(ref.kind, 'committed');
				if (ref.kind !== 'committed') return assert.fail('upload refused');
				const run = yield* admin.start('roster_entry.sync.work_sheet', {
					mode: 'import',
					file: ref.output.id,
					context
				});
				if (run.kind !== 'committed') return assert.fail('import refused');
				return Schema.decodeUnknownSync(Imported)(yield* finished(run.output.id));
			});

			const before = yield* state();
			const unchanged = yield* upload(lines);
			assert.deepEqual(
				unchanged.findings.filter((finding) => finding.severity === 'refuse'),
				[]
			);
			assert.equal(unchanged.applied, true);
			assert.deepEqual(yield* state(), before, 'an unchanged sheet writes nothing');

			// an older file's Leave column, garbage included: ignored, no finding, nothing written
			const ignored = yield* upload(
				lines.map((line, i) => [...line, ['', 'AL', 'UL (PM) + ??'][i % 3] ?? '']),
				[...header, 'Leave']
			);
			assert.equal(ignored.applied, true);
			assert.deepEqual(ignored.findings, unchanged.findings);
			assert.deepEqual(yield* state(), before, 'the Leave column writes nothing');

			// one error refuses the whole file: the valid change beside it is not written
			const edit = (date: string, cells: { [F in SheetField]?: string }) =>
				lines.map((line) =>
					line[column('employee_number')] === 'E1' && line[column('work_date')] === date
						? line.map((cell, i) => {
								const field = Object.entries(SHEET_COLUMNS).find(
									([, label]) => label === header[i]
								)?.[0];
								return field !== undefined && isField(field) && field in cells
									? cells[field]!
									: cell;
							})
						: line
				);
			const OVERTIME = { shift_code: 'D', clock_in: '08:00', clock_out: '20:00' };
			const refused = yield* upload(
				edit('2026-03-02', OVERTIME).map((line, i) =>
					line[column('work_date')] === '2026-03-06' && line[column('employee_number')] === 'E1'
						? edit('2026-03-06', { shift_code: 'PH' })[i]!
						: line
				)
			);
			assert.equal(refused.applied, false);
			assert.ok(refused.findings.some((finding) => /PH is not a shift code/.test(finding.message)));
			assert.deepEqual(yield* state(), before, 'a refused file writes nothing');

			// warnings alone: imported in one step, the warnings reported with the counts
			const warned = yield* upload(edit('2026-03-02', OVERTIME));
			assert.equal(warned.applied, true);
			assert.ok(warned.findings.length > 0 && warned.findings.every((f) => f.severity === 'warn'));
			assert.notDeepEqual(yield* state(), before);
		})
	);
});
