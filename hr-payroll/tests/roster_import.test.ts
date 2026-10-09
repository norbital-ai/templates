/**
 * The `roster_entry` pipeline's hooks (known → map → related → check) over an xlsx written here, against fixture
 * rows: what each row maps to, the leave it records once, settled days, blanks, a holiday and a leaver's tail, and a
 * configured `roster` validation as a warning or a refusal. The scope's deletes and the xlsx decode are Bolt's (the
 * e2e suite runs them for real).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { Effect } from 'effect';
import { Refusal, runEngine, type HostRead } from '../src/lib/payroll_engine/foundation.ts';
import { planRosterImport, rosterSheet, runHook } from '../src/lib/payroll_engine/roster_import.ts';
import { SHEET_COLUMNS, isField } from '../src/lib/payroll_engine/roster_sheet.ts';

type Row = Record<string, unknown>;
const ZONE = 'Asia/Singapore';
const VERSION = 'v1';
const contract = (id: string, number: string, to: string | null = null): Row => ({
	id,
	company_id: 'c1',
	employee_id: `p-${id}`,
	employee_number: number,
	effective_range: { from: '2025-01-01', to },
	facts: {}
});
const entry = (id: string, employment_id: string, work_date: string, extra: Row = {}): Row => ({
	id,
	employment_id,
	work_date,
	shift_definition_id: 'D',
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
					id: 'c1',
					name: 'Acme',
					settings_code: 'XX',
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
				{ id: 'p-k1', name: 'Ann' },
				{ id: 'p-k2', name: 'Ben' }
			]
		],
		[
			'shift_definition',
			[
				{
					id: 'D',
					company_id: 'c1',
					code: 'D',
					variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00' }
				},
				{ id: 'R', company_id: 'c1', code: 'R', variant: { day_type: 'REST' } }
			]
		],
		['shift_pattern', []],
		[
			'holiday',
			[
				{
					id: 'h1',
					company_id: 'c1',
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
				entry('e1', 'k1', '2026-03-02', {
					worked_intervals: [{ start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T10:00:00.000Z' }]
				}),
				entry('e2', 'k1', '2026-03-03'),
				entry('e3', 'k1', '2026-03-04', {
					approved_overtime_hours: 1,
					overtime_consented_at: '2026-03-02T09:00:00.000Z'
				}),
				entry('e4', 'k1', '2026-03-06', { payslip_id: 'p1' }),
				entry('e5', 'k2', '2026-03-05'),
				entry('e6', 'k1', '2026-03-08')
			].map((row) => overrides.entries?.find((over) => over.id === row.id) ?? row)
		],
		['leave_catalog', [{ id: 'AL1', settings_id: VERSION, code: 'AL' }]],
		[
			'leave_catalog_entry',
			[
				{
					employment_id: 'k1',
					catalog_id: 'AL1',
					activity: 'TIME_OFF',
					occurred_on: '2026-03-08',
					days: 1,
					from: '2026-03-08',
					to: '2026-03-08'
				},
				...(overrides.leave ?? [])
			]
		],
		['payslip', overrides.payslips ?? []],
		['payroll_run', overrides.runs ?? []],
		['rule_set', overrides.rules ?? []]
	]);
	const matches = (row: Row, where: Row): boolean =>
		Object.entries(where).every(([key, spec]) =>
			Object.entries(spec as Row).every(([op, operand]) => {
				const value = row[key];
				if (op === 'eq') return value === operand;
				if (op === 'in') return Array.isArray(operand) && operand.includes(value);
				if (op === 'isNull') return operand ? value == null : value != null;
				if (op === 'gte') return value != null && String(value) >= String(operand);
				if (op === 'lte') return value != null && String(value) <= String(operand);
				throw new Error(`fixture reader: unsupported operator ${op}`);
			})
		);
	return (async (collection: string, query: { where?: Row }) => ({
		rows: (tables.get(collection) ?? []).filter((row) => matches(row, query.where ?? {}))
	})) as unknown as HostRead;
};

/** The sheet as HR fills it: header row, then the cells by column. */
const FILLED: (string | number)[][] = [
	['E1', '2026-03-02', 'D', '09:00', '18:00'],
	['E1', '2026-03-04', 'D', '', '', 2],
	['E1', '2026-03-05', 'D', '22:00', '06:00'],
	['E1', '2026-03-06', 'D'],
	['E1', '2026-03-07', '', '', '', '', '', '', '', 'AL'],
	['E1', '2026-03-09'],
	['E2', '2026-03-05'],
	['E2', '2026-03-11'],
	['E1', '2026-03-08', 'D', '', '', '', '', '', '', 'AL']
];
/** The sheet as a file, read back by header as the pipeline reads it: one record per row, blank cells absent. */
const xlsx = async (rows: readonly (readonly (string | number)[])[]) => {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet('Work days');
	sheet.addRow(Object.values(SHEET_COLUMNS));
	for (const row of rows) sheet.addRow([...row]);
	const read = new ExcelJS.Workbook();
	await read.xlsx.load((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
	const fields = Object.keys(SHEET_COLUMNS).filter(isField);
	const out: ({ row: number } & Record<string, string | number>)[] = [];
	read.worksheets[0]!.eachRow((line, index) => {
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
};
const plan = (rows: Awaited<ReturnType<typeof xlsx>>, read: HostRead = fixture()) =>
	runEngine(planRosterImport({ company_id: 'c1', rows }), read, (message) => {
		throw new Error(message);
	});
const at = (result: Awaited<ReturnType<typeof plan>>, date: string) =>
	result.rows.find(
		(row) => row != null && String(row.work_date) === date && row.employment_id === 'k1'
	);
const overtimeRule = (kind: string): Row => ({
	settings_id: VERSION,
	family: 'VALIDATIONS',
	code: 'OVERTIME_DAILY',
	rules: {
		site: 'roster',
		kind,
		column: 'overtime_hours',
		when: 'day.overtime_hours > 1.5',
		message: 'more than 1.5 overtime hours in a day'
	}
});

describe('work-day sheet import', () => {
	it('maps each row onto its day: kept intervals, overtime, an overnight clock; blanks, holidays and a leaver map to nothing', async () => {
		const result = await plan(await xlsx(FILLED));
		assert.deepEqual(result.errors, []);
		// the stored 09:00–18:00 day restates its own intervals
		assert.deepEqual(at(result, '2026-03-02')?.worked_intervals, [
			{ start: '2026-03-02T01:00:00.000Z', end: '2026-03-02T10:00:00.000Z' }
		]);
		assert.equal(at(result, '2026-03-04')?.approved_overtime_hours, 2);
		assert.deepEqual(
			(at(result, '2026-03-05')?.worked_intervals ?? []).map((row) => [
				String(row.start),
				String(row.end)
			]),
			[['2026-03-05T14:00:00.000Z', '2026-03-05T22:00:00.000Z']]
		);
		// the pinned day and the day on recorded leave restate their planned shift; the holiday is blank
		assert.equal(at(result, '2026-03-06')?.shift_definition_id, 'D');
		assert.equal(at(result, '2026-03-08')?.shift_definition_id, 'D');
		assert.equal(at(result, '2026-03-09'), undefined);
		assert.equal(at(result, '2026-03-07'), undefined);
		// E2 maps nothing: a blank day (the scope cannot reach it, so it warns) and a day after the exit
		assert.ok(result.rows.every((row) => row == null || row.employment_id === 'k1'));
		assert.deepEqual(
			result.warnings.map((finding) => finding.row),
			[8]
		);
		// 03-07's AL is recorded once; 03-08's AL is already on file
		assert.equal(result.leave.length, 1);
		assert.equal(result.leave[0]!.catalog_id, 'AL1');
		assert.equal(String(result.leave[0]!.from), '2026-03-07');
		const again = await plan(
			await xlsx(FILLED),
			fixture({
				leave: [
					{
						employment_id: 'k1',
						catalog_id: 'AL1',
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
	});

	it('a hook without a fallback rejects with the refusal: a failed template download says why', async () => {
		await assert.rejects(
			runHook(
				Effect.fail(new Refusal({ message: 'No sealed XX version governs 2026-03-01.' })),
				fixture()
			),
			/No sealed XX version governs/
		);
		assert.deepEqual(
			await runHook(Effect.fail(new Refusal({ message: 'x' })), fixture(), (message) => [message]),
			['x']
		);
	});

	it('an entity without a zone counts clocks in its governing version’s payroll.timezone, import and template alike', async () => {
		const read = fixture({ versionZone: true });
		const result = await plan(await xlsx([['E1', '2026-03-03', 'D', '09:00', '18:00']]), read);
		assert.deepEqual(result.errors, []);
		assert.deepEqual(
			(at(result, '2026-03-03')?.worked_intervals ?? []).map((row) => [
				String(row.start),
				String(row.end)
			]),
			[['2026-03-03T01:00:00.000Z', '2026-03-03T10:00:00.000Z']]
		);
		const sheet = await runEngine(
			rosterSheet({ company_id: 'c1', from: '2026-03-02', to: '2026-03-02' }, '2026-03-02'),
			read,
			(message) => {
				throw new Error(message);
			}
		);
		assert.deepEqual(
			sheet
				.filter((row) => row.employee_number === 'E1')
				.map((row) => [row.clock_in, row.clock_out]),
			[['09:00', '18:00']]
		);
	});

	it('refuses a change to a settled day, naming its row, and a settled day the scope would delete', async () => {
		const changed = FILLED.map((row) =>
			row[1] === '2026-03-06' ? ['E1', '2026-03-06', 'D', '09:00', '17:00'] : row
		);
		const pinned = await plan(await xlsx(changed));
		assert.equal(pinned.errors.length, 1);
		assert.equal(pinned.errors[0]!.row, 5);
		assert.match(pinned.errors[0]!.message, /settled on a payslip/);
		// a day on recorded leave keeps its planned shift, but takes no clock
		const onLeave = await plan(
			await xlsx(
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
		const paid = await plan(
			await xlsx(FILLED),
			fixture({
				payslips: [{ employment_id: 'k1', payroll_run_id: 'r1' }],
				runs: [
					{ id: 'r1', kind: 'REGULAR', attendance_from: '2026-03-03', attendance_to: '2026-03-03' }
				]
			})
		);
		assert.deepEqual(
			paid.errors.map((finding) => finding.row),
			[null]
		);
		assert.match(paid.errors[0]!.message, /E1 2026-03-03 is inside a period already paid/);
	});

	it('blocks on structure whatever the rules say: unknown employee, a leaver with values, a repeat, an unknown shift, half a clock', async () => {
		const result = await plan(
			await xlsx([
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
	});

	it("OT consent is the day's own: marked or dated sets it, a restatement keeps it, blank clears it, a settled day keeps it", async () => {
		// 2026-03-04 holds consent given 2026-03-02 17:00 local; 2026-03-05 holds none
		const consent = async (cell: string | number, date = '2026-03-04') =>
			(
				await plan(
					await xlsx(
						FILLED.map((row) => (row[1] === date ? ['E1', date, 'D', '', '', 2, cell] : row))
					)
				)
			).rows.find((row) => row != null && String(row.work_date) === date)?.overtime_consented_at ??
			null;
		// marked: a new consent is the work day's local start; a restated one keeps its instant
		assert.equal(String(await consent('Y', '2026-03-05')), '2026-03-04T16:00:00.000Z');
		for (const mark of ['Y', 'yes', 'TRUE', 1, '2026-03-02'])
			assert.equal(String(await consent(mark)), '2026-03-02T09:00:00.000Z', String(mark));
		// a date: that day's local start, typed or as an Excel date serial (46082 = 2026-03-01)
		assert.equal(String(await consent('2026-03-04')), '2026-03-03T16:00:00.000Z');
		assert.equal(String(await consent(46082)), '2026-02-28T16:00:00.000Z');
		// blank: the restated day carries none (the set clears the stored consent); no consent is derived from overtime
		assert.equal(at(await plan(await xlsx(FILLED)), '2026-03-04')?.overtime_consented_at, null);
		const refused = await plan(
			await xlsx(
				FILLED.map((row) =>
					row[1] === '2026-03-04' ? ['E1', '2026-03-04', 'D', '', '', 2, 'maybe'] : row
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
				entry('e4', 'k1', '2026-03-06', {
					payslip_id: 'p1',
					overtime_consented_at: '2026-03-05T02:00:00.000Z'
				})
			]
		});
		const onPinned = async (cell: string) =>
			plan(
				await xlsx(
					FILLED.map((row) =>
						row[1] === '2026-03-06' ? ['E1', '2026-03-06', 'D', '', '', '', cell] : row
					)
				),
				pinned
			);
		assert.deepEqual((await onPinned('Y')).errors, []);
		assert.deepEqual(
			(await onPinned('')).errors.map((finding) => [finding.row, finding.message]),
			[[5, 'E1 2026-03-06 is settled on a payslip and cannot change.']]
		);
		const marked = await plan(
			await xlsx(
				FILLED.map((row) =>
					row[1] === '2026-03-06' ? ['E1', '2026-03-06', 'D', '', '', '', 'Y'] : row
				)
			)
		);
		assert.match(marked.errors[0]!.message, /settled on a payslip/);
		// the template prefills the stored consent as its local day, which re-imports unchanged
		const sheet = await runEngine(
			rosterSheet({ company_id: 'c1', from: '2026-03-04', to: '2026-03-05' }, '2026-03-10'),
			fixture(),
			(message) => {
				throw new Error(message);
			}
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
	});

	it('a configured roster rule warns or refuses as its kind says', async () => {
		const warned = await plan(await xlsx(FILLED), fixture({ rules: [overtimeRule('warn')] }));
		assert.deepEqual(warned.errors, []);
		assert.deepEqual(
			warned.warnings.filter((finding) => finding.row === 3),
			[
				{
					row: 3,
					column: SHEET_COLUMNS.overtime_hours,
					message: 'more than 1.5 overtime hours in a day'
				}
			]
		);
		const refused = await plan(await xlsx(FILLED), fixture({ rules: [overtimeRule('refuse')] }));
		assert.deepEqual(
			refused.errors.map((finding) => finding.row),
			[3]
		);
	});
});
