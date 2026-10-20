/**
 * The `roster_entry` pipeline on the private sample pack, whatever its lineages, through the real upload and run: the
 * template of one entity's week (page context) re-imported unchanged writes nothing; the same file with a day blanked,
 * a clock past the shift added and a leave code added deletes, updates and records exactly those; importing it again changes
 * nothing and records no second day of leave. The ID lineage's overtime-consent task is raised for a day the sheet clocks
 * past its shift without consent, and not for one it marks consented. Skipped when the build carries no sample pack.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { expect, it } from '@effect/vitest';
import { Effect, Option, Schema } from 'effect';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt/test';
import { RunHandlers, type Json } from '@norbital-ai/bolt/engine';
import { addDays, PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { fieldValue, numberOf } from '../../src/lib/payroll_engine/foundation.ts';
import { nativeId } from '../fixture_values.ts';
import { workspace } from '../kit.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Stored days retain their native date type while the workbook carries their ISO text.
const iso = (value: PlainDate): string => value;
/** The first planned day with `need` ordinary (not REST/OFF), unattended days of its employment `from`..`to` days on. */
const firstWindow = <
	R extends { employment_id: string; work_date: PlainDate; shift_definition_id: string | null }
>(
	rows: readonly R[],
	rest: ReadonlySet<string>,
	from: number,
	to: number,
	need: number
): R | undefined =>
	rows.find(
		(row) =>
			rows.filter(
				(other) =>
					other.employment_id === row.employment_id &&
					other.shift_definition_id !== null &&
					!rest.has(other.shift_definition_id) &&
					other.work_date >= addDays(row.work_date, from) &&
					other.work_date <= addDays(row.work_date, to)
			).length >= need
	);
type Cell = string | number | null;

class WorkbookIoFailed extends Schema.TaggedError<WorkbookIoFailed>()('WorkbookIoFailed', {
	message: Schema.String
}) {}
const readSheet = Effect.fnUntraced(function* (bytes: Uint8Array) {
	const book = new ExcelJS.Workbook();
	yield* Effect.tryPromise({
		try: () => book.xlsx.load(Uint8Array.from(bytes).buffer),
		catch: (cause) => new WorkbookIoFailed({ message: String(cause) })
	});
	const sheet = book.worksheets[0];
	if (sheet === undefined) throw new Error('The roster template must have its worksheet');
	const out: Cell[][] = [];
	sheet.eachRow({ includeEmpty: false }, (row) => {
		const values = Array.isArray(row.values) ? row.values.slice(1) : [];
		out.push(
			values.map((value) =>
				Schema.is(Schema.Union([Schema.Number, Schema.String]))(value) ? value : null
			)
		);
	});
	return out;
});
const writeSheet = Effect.fnUntraced(function* (cells: readonly (readonly Cell[])[]) {
	const book = new ExcelJS.Workbook();
	const sheet = book.addWorksheet('Work days');
	for (const row of cells) sheet.addRow([...row]);
	const bytes = yield* Effect.tryPromise({
		try: () => book.xlsx.writeBuffer(),
		catch: (cause) => new WorkbookIoFailed({ message: String(cause) })
	});
	return new Uint8Array(bytes);
});
const runPipeline = Effect.fnUntraced(function* (input: Json, starter: Kit['admin']) {
	const registry = yield* RunHandlers;
	const handler = yield* registry.handler('roster_entry.pipeline');
	if (Option.isNone(handler)) throw new Error('The roster pipeline must be registered');
	return yield* handler.value(input, { id: randomUUID(), starter });
});
const TemplateReply = Schema.Struct({
	file: Schema.Struct({
		id: Schema.String,
		name: Schema.String,
		mime: Schema.String,
		bytes: Schema.Number,
		sha256: Schema.String
	})
});
const storedSheet = Effect.fnUntraced(function* (t: Kit, output: Json) {
	const { file } = yield* Schema.decodeUnknownEffect(TemplateReply)(output);
	const stored = yield* t.db.one(Schema.Struct({ key: Schema.String }), {
		text: 'SELECT key FROM sys_file WHERE id = $1',
		params: [nativeId('sys_file', file.id)]
	});
	if (Option.isNone(stored)) throw new Error('The roster template must have its stored file');
	const bytes = t.fakes.files.blobs.get(stored.value.key);
	if (bytes === undefined)
		throw new Error('The roster template must have its actual workbook bytes');
	return yield* readSheet(bytes);
});
const required = <A>(value: A | null | undefined, label: string): A => {
	if (value == null) throw new Error(label);
	return value;
};
const options = { sample: true, now: '2026-02-10T04:00:00.000Z' } as const;

it.live.skipIf(!sample)(
	'the work-day sheet round trip: template, unchanged re-import, a leave on an off day refused, a set, and an idempotent repeat',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const member = t.member(['hr_manager'], { teams: ['019f8a10-0000-7000-8000-000000000006'] });
			const hr = t.as(member);
			const run = (input: Json) => runPipeline(input, member);
			const upload = Effect.fnUntraced(function* (
				cells: readonly (readonly Cell[])[],
				by: typeof hr = hr
			) {
				const bytes = yield* writeSheet(cells);
				const out = yield* by.upload('roster_entry.$import', {
					name: 'work-days.xlsx',
					mime: XLSX,
					bytes
				});
				if (out.kind !== 'committed') throw new Error(JSON.stringify(out));
				return out.output.id;
			});

			// the source bank's weeks carry real attendance: take a week with three ordinary middle days, then clear
			// its clocks below so the edits start from plain planned days
			const open = (yield* hr.read('roster_entry', {
				where: { shift_definition_id: { isNull: false }, payslip_id: { isNull: true } },
				orderBy: { work_date: 'asc' },
				all: true
			})).rows;
			const rest = new Set(
				(yield* hr.read('shift_definition', { select: { code: true }, all: true })).rows
					.filter((row) => ['REST', 'OFF'].includes(String(row.code)))
					.map((row) => row.id)
			);
			const seed = firstWindow(open, rest, 1, 5, 3);
			const selected = required(seed, 'The sample requires an unsettled planned work day');
			const employment_id = yield* Effect.fromResult(
				fieldValue(selected.employment_id, 'roster_entry.employment_id')
			);
			const contract = required(
				yield* hr.get('employment_contract', employment_id),
				'The sample requires the work day employment'
			);
			const company_id = yield* Effect.fromResult(
				fieldValue(contract.company_id, 'employment_contract.company_id')
			);
			const number = yield* Effect.fromResult(
				fieldValue(contract.employee_number, 'employment_contract.employee_number')
			);
			const from = iso(
				yield* Effect.fromResult(fieldValue(selected.work_date, 'roster_entry.work_date'))
			);
			const to = addDays(from, 6);
			const context = { company_id, from, to };
			for (const row of open)
				if (
					row.employment_id === employment_id &&
					row.worked_intervals !== null &&
					row.work_date >= context.from &&
					row.work_date <= context.to
				)
					expect(
						yield* t
							.as(t.admin)
							.act('roster_entry.update', { target: row.id, set: { worked_intervals: null } })
					).toMatchObject({ kind: 'committed' });
			// Planned overtime belongs to HR's plan authority, including an older file without that optional column.
			expect(
				yield* hr.act('roster_entry.update', {
					target: selected.id,
					set: { planned_overtime_hours: Decimal.of('3') }
				})
			).toMatchObject({ kind: 'committed' });

			// the template follows the page: this entity, this week
			const cells = yield* storedSheet(t, yield* run({ mode: 'template', context }));
			const header = required(cells[0], 'The roster template needs its header');
			const col = (label: string) => header.indexOf(label);
			expect(header.slice(0, 3)).toEqual(['Employee number', 'Date', 'Shift']);
			expect(header).not.toContain('Incentive hours');
			// overtime is the clock past the shift's hours, never a typed column; consent follows the clock it covers
			expect(header).not.toContain('Overtime hours');
			expect(col('OT consent')).toBe(col('Clock out') + 1);
			const mine = cells.slice(1).filter((row) => row[col('Employee number')] === number);
			expect(mine.length).toBeGreaterThan(2);
			expect(
				cells
					.slice(1)
					.every((row) => String(row[col('Date')]) >= from && String(row[col('Date')]) <= to)
			).toBe(true);

			const unchanged = yield* run({
				mode: 'import',
				file: yield* upload([header, ...mine]),
				context,
				accept: true
			});
			expect(unchanged, JSON.stringify(unchanged)).toMatchObject({
				applied: true,
				created: 0,
				updated: 0,
				deleted: 0
			});
			expect(col('Planned OT hours')).toBe(10);
			const legacy = yield* run({
				mode: 'import',
				file: yield* upload([header.slice(0, 10), ...mine.map((row) => row.slice(0, 10))]),
				context,
				accept: true
			});
			expect(legacy, JSON.stringify(legacy)).toMatchObject({
				applied: true,
				created: 0,
				updated: 0,
				deleted: 0
			});
			const preserved = required(
				yield* hr.get('roster_entry', selected.id),
				'The unchanged old-format upload keeps the planned work day'
			);
			expect(
				numberOf(
					yield* Effect.fromResult(
						fieldValue(preserved.planned_overtime_hours, 'roster_entry.planned_overtime_hours')
					)
				)
			).toBe(3);

			// edit: blank a middle day with a shift, overtime on another, a leave code on a third
			const plain = (row: Cell[]) =>
				row[col('Leave')] == null &&
				row[col('Clock in')] == null &&
				!['REST', 'OFF'].includes(String(row[col('Shift')]));
			const middle = mine.slice(1, -1);
			const blank = middle.find((row) => row[col('Shift')] != null && plain(row));
			const overtime = middle.find(
				(row) => row !== blank && row[col('Shift')] != null && plain(row)
			);
			const leaveDay = middle.find((row) => row !== blank && row !== overtime && plain(row));
			expect(blank && overtime && leaveDay, 'the week has three plain middle days').toBeTruthy();
			// a leave class the entity already uses in that version
			const used = yield* Effect.forEach(
				(yield* hr.read('leave_catalog_entry', {
					where: { employment_id: { eq: employment_id }, activity: { eq: 'TIME_OFF' } },
					all: true
				})).rows,
				(entry) =>
					Effect.fromResult(fieldValue(entry.catalog_id, 'leave_catalog_entry.catalog_id')).pipe(
						Effect.map((catalog_id) => ({ ...entry, catalog_id }))
					),
				{ concurrency: 'unbounded' }
			);
			const classes = (yield* hr.read('leave_catalog', { all: true })).rows;
			const usedClass = required(
				classes.find((row) => used.some((entry) => entry.catalog_id === row.id)),
				'The sample needs its used leave class'
			);
			const code = yield* Effect.fromResult(fieldValue(usedClass.code, 'leave_catalog.code'));
			expect(code).not.toBe('');
			const editedWith = (leave: boolean) => [
				header,
				...mine.map((row) => {
					if (row === blank) return row.slice(0, 2);
					const out = [...row];
					if (row === overtime) {
						// a 13-hour clock: past any of the sample's shifts
						out[col('Clock in')] = '07:00';
						out[col('Clock out')] = '20:00';
						out[col('Planned OT hours')] = 6;
					}
					if (leave && row === leaveDay) out[col('Leave')] = code;
					return out;
				})
			];
			const day = (row: Cell[] | undefined) =>
				String(required(row, 'The scenario requires its chosen work day')[col('Date')]);
			const leaveOn = Effect.fnUntraced(function* () {
				return (yield* hr.read('leave_catalog_entry', {
					where: {
						employment_id: { eq: employment_id },
						occurred_on: { eq: PlainDate(day(leaveDay)) }
					},
					all: true
				})).rows.length;
			});
			// The fixture week's plain days are a rest day, a holiday and an off day: a leave code there charges nothing
			// on the employment's own plan, so the server refuses it rather than charging a day.
			const refused = yield* run({
				mode: 'import',
				file: yield* upload(editedWith(true)),
				context,
				accept: true
			});
			expect(refused, JSON.stringify(refused)).toMatchObject({ applied: false });
			expect(JSON.stringify(refused)).toMatch(/charges nothing/);
			expect(yield* leaveOn()).toBe(0);

			const edited = editedWith(false);
			// The clock is attendance and overtime follows it: an HR Manager's clock change waits for a reviewer.
			expect(
				yield* run({ mode: 'import', file: yield* upload(edited), context, accept: true })
			).toMatchObject({ pendingApproval: true });
			const set = yield* runPipeline(
				{ mode: 'import', file: yield* upload(edited, t.as(t.admin)), context, accept: true },
				t.admin
			);
			expect(set, JSON.stringify(set)).toMatchObject({ applied: true });
			const afterRows = yield* Effect.forEach(
				(yield* hr.read('roster_entry', {
					where: {
						employment_id: { eq: employment_id },
						work_date: { gte: PlainDate(from), lte: PlainDate(to) }
					},
					all: true
				})).rows,
				(row) =>
					Effect.fromResult(fieldValue(row.work_date, 'roster_entry.work_date')).pipe(
						Effect.map((work_date) => ({ ...row, work_date }))
					),
				{ concurrency: 'unbounded' }
			);
			const after = new Map(afterRows.map((row) => [iso(row.work_date), row]));
			expect(after.has(day(blank))).toBe(false);
			const overtimeRow = required(
				after.get(day(overtime)),
				'The imported overtime work day must exist'
			);
			const clocked = yield* Effect.fromResult(
				fieldValue(overtimeRow.worked_intervals, 'roster_entry.worked_intervals')
			);
			expect(clocked?.length).toBe(1);

			const again = yield* run({
				mode: 'import',
				file: yield* upload(edited),
				context,
				accept: true
			});
			expect(again, JSON.stringify(again)).toMatchObject({
				applied: true,
				created: 0,
				updated: 0,
				deleted: 0
			});
		}).pipe(Effect.provide(workspace(options))),
	{ timeout: 600_000 }
);

it.live.skipIf(!sample)(
	'OT consent round trip: the ID consent task is raised for overtime without consent, not for overtime with it',
	() =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const member = t.member(['hr_manager'], { teams: ['019f8a10-0000-7000-8000-000000000006'] });
			const hr = t.as(member);
			const run = (input: Json) => runPipeline(input, member);
			const upload = Effect.fnUntraced(function* (
				cells: readonly (readonly Cell[])[],
				by: typeof hr = hr
			) {
				const bytes = yield* writeSheet(cells);
				const out = yield* by.upload('roster_entry.$import', {
					name: 'work-days.xlsx',
					mime: XLSX,
					bytes
				});
				if (out.kind !== 'committed') throw new Error(JSON.stringify(out));
				return out.output.id;
			});
			const [entity] = (yield* hr.read('entity', {
				where: { settings_code: { eq: 'ID' } },
				all: true
			})).rows;
			const company_id = required(entity, 'The sample needs its ID entity').id;
			const contracts = (yield* hr.read('employment_contract', {
				where: { company_id: { eq: company_id } },
				all: true
			})).rows;
			const rest = new Set(
				(yield* hr.read('shift_definition', { select: { code: true }, all: true })).rows
					.filter((row) => ['REST', 'OFF'].includes(String(row.code)))
					.map((row) => row.id)
			);
			const open = (yield* hr.read('roster_entry', {
				where: {
					employment_id: { in: contracts.map((row) => row.id) },
					shift_definition_id: { isNull: false },
					payslip_id: { isNull: true }
				},
				orderBy: { work_date: 'asc' },
				all: true
			})).rows;
			const seed = firstWindow(open, rest, 0, 6, 2);
			const selected = required(seed, 'The ID sample requires an unsettled planned work day');
			const employment_id = yield* Effect.fromResult(
				fieldValue(selected.employment_id, 'roster_entry.employment_id')
			);
			const contract = required(
				contracts.find((row) => row.id === employment_id),
				'The ID sample needs the work day employment'
			);
			const number = yield* Effect.fromResult(
				fieldValue(contract.employee_number, 'employment_contract.employee_number')
			);
			const from = iso(
				yield* Effect.fromResult(fieldValue(selected.work_date, 'roster_entry.work_date'))
			);
			const context = { company_id, from, to: addDays(from, 6) };
			for (const row of open)
				if (
					row.employment_id === employment_id &&
					row.worked_intervals !== null &&
					row.work_date >= context.from &&
					row.work_date <= context.to
				)
					expect(
						yield* t
							.as(t.admin)
							.act('roster_entry.update', { target: row.id, set: { worked_intervals: null } })
					).toMatchObject({ kind: 'committed' });
			const cells = yield* storedSheet(t, yield* run({ mode: 'template', context }));
			const header = required(cells[0], 'The roster template needs its header');
			const col = (label: string) => header.indexOf(label);
			const mine = cells.slice(1).filter((row) => row[col('Employee number')] === number);
			// two stored planned days with nothing else on them: overtime on both, consent on one
			const plain = mine.filter(
				(row) =>
					row[col('Shift')] != null &&
					!['REST', 'OFF'].includes(String(row[col('Shift')])) &&
					row[col('Leave')] == null &&
					row[col('Clock in')] == null &&
					row[col('OT consent')] == null
			);
			const [without, consented] = plain;
			expect(without && consented, 'the week has two plain planned days').toBeTruthy();
			const edited = [
				header,
				...mine.map((row) => {
					const out = [...row];
					while (out.length < header.length) out.push(null);
					if (row === without || row === consented) {
						out[col('Clock in')] = '07:00';
						out[col('Clock out')] = '20:00';
						out[col('Planned OT hours')] = 6;
					}
					if (row === consented) out[col('OT consent')] = 'Y';
					return out;
				})
			];
			// The clock past the shift is attendance: the workspace admin records it without a reviewer.
			const set = yield* runPipeline(
				{ mode: 'import', file: yield* upload(edited, t.as(t.admin)), context, accept: true },
				t.admin
			);
			expect(set, JSON.stringify(set)).toMatchObject({ applied: true });
			yield* t.runDue();
			yield* t.settled();
			const day = (row: Cell[] | undefined) =>
				String(required(row, 'The scenario requires its chosen work day')[col('Date')]);
			const dayRows = yield* Effect.forEach(
				(yield* hr.read('roster_entry', {
					where: {
						employment_id: { eq: employment_id },
						work_date: { gte: PlainDate(from), lte: PlainDate(context.to) }
					},
					all: true
				})).rows,
				(row) =>
					Effect.fromResult(fieldValue(row.work_date, 'roster_entry.work_date')).pipe(
						Effect.map((work_date) => ({ ...row, work_date }))
					),
				{ concurrency: 'unbounded' }
			);
			const days = new Map(dayRows.map((row) => [iso(row.work_date), row]));
			const withoutRow = required(
				days.get(day(without)),
				'The imported nonconsented work day must exist'
			);
			const consentedRow = required(
				days.get(day(consented)),
				'The imported consented work day must exist'
			);
			const withoutConsent = yield* Effect.fromResult(
				fieldValue(withoutRow.overtime_consented_at, 'roster_entry.overtime_consented_at')
			);
			const recordedConsent = yield* Effect.fromResult(
				fieldValue(consentedRow.overtime_consented_at, 'roster_entry.overtime_consented_at')
			);
			expect(withoutConsent ?? null).toBeNull();
			expect(recordedConsent).not.toBeNull();
			const raisedSubjects = yield* Effect.forEach(
				(yield* hr.read('regulatory_task', {
					where: { code: { eq: 'OVERTIME_WRITTEN_ORDER' } },
					all: true
				})).rows,
				(row) => Effect.fromResult(fieldValue(row.subject_id, 'regulatory_task.subject_id')),
				{ concurrency: 'unbounded' }
			);
			const raised = new Set(raisedSubjects.map(String));
			expect(
				raised.has(
					required(days.get(day(without)), 'The imported nonconsented work day must exist').id
				)
			).toBe(true);
			expect(
				raised.has(
					required(days.get(day(consented)), 'The imported consented work day must exist').id
				)
			).toBe(false);

			// the template now prefills the consent; re-imported unchanged it writes nothing
			const restated = (yield* storedSheet(t, yield* run({ mode: 'template', context }))).filter(
				(row, i) => i === 0 || row[col('Employee number')] === number
			);
			expect(
				restated.find((row) => String(row[col('Date')]) === day(consented))?.[col('OT consent')]
			).toBe(day(consented));
			const unchanged = yield* run({
				mode: 'import',
				file: yield* upload(restated),
				context,
				accept: true
			});
			expect(unchanged, JSON.stringify(unchanged)).toMatchObject({
				applied: true,
				created: 0,
				updated: 0,
				deleted: 0
			});
		}).pipe(Effect.provide(workspace(options))),
	{ timeout: 600_000 }
);
