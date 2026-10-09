/**
 * The `roster_entry` pipeline on the private sample pack, whatever its lineages, through the real upload and run: the
 * template of one entity's week (page context) re-imported unchanged writes nothing; the same file with a day blanked,
 * overtime changed and a leave code added deletes, updates and records exactly those; importing it again changes
 * nothing and records no second day of leave. The ID lineage's overtime-consent task is raised for a day the sheet gives
 * overtime without consent, and not for one it marks consented. Skipped when the build carries no sample pack.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { workspace } from '../kit.ts';

const sample = existsSync(`${process.cwd()}/.norbital/seed/sample/pack.json`);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const addDays = (day: string, n: number) => {
	const stamp = new Date(`${day}T00:00:00Z`);
	stamp.setUTCDate(stamp.getUTCDate() + n);
	return stamp.toISOString().slice(0, 10);
};
// the kit's reads tag a date (`{ $d }`); the sheet speaks ISO days
const iso = (value: unknown) => /\d{4}-\d{2}-\d{2}/.exec(JSON.stringify(value))?.[0] ?? '';
type Cell = string | number | null;

const readSheet = async (bytes: Uint8Array): Promise<Cell[][]> => {
	const book = new ExcelJS.Workbook();
	await book.xlsx.load(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
	);
	const out: Cell[][] = [];
	book.worksheets[0]!.eachRow({ includeEmpty: false }, (row) => {
		const values = Array.isArray(row.values) ? row.values.slice(1) : [];
		out.push(values.map((v) => (typeof v === 'number' || typeof v === 'string' ? v : null)));
	});
	return out;
};
const writeSheet = async (cells: readonly (readonly Cell[])[]) => {
	const book = new ExcelJS.Workbook();
	const sheet = book.addWorksheet('Work days');
	for (const row of cells) sheet.addRow([...row]);
	return new Uint8Array(await book.xlsx.writeBuffer());
};

it.skipIf(!sample)(
	'the work-day sheet round trip: template, unchanged re-import, a leave on an off day refused, a set, and an idempotent repeat',
	{ timeout: 600_000 },
	async () => {
		const t = await workspace({ sample: true, now: '2026-02-10T04:00:00.000Z' });
		const member = t.member(['hr_manager']);
		const hr = t.as(member);
		const run = (input: Record<string, unknown>) =>
			t.engine.pipelines.handlers()['roster_entry.pipeline']!(JSON.parse(JSON.stringify(input)), {
				id: randomUUID(),
				starter: member
			}) as Promise<Record<string, unknown>>;
		const upload = async (cells: readonly (readonly Cell[])[]) => {
			const out = await hr.upload('roster_entry.$import', {
				name: 'work-days.xlsx',
				mime: XLSX,
				bytes: await writeSheet(cells)
			});
			if (out.kind !== 'committed') throw new Error(JSON.stringify(out));
			return (out.output as { id: string }).id;
		};

		const [seed] = (
			await hr.read('roster_entry', {
				where: { shift_definition_id: { isNull: false }, payslip_id: { isNull: true } },
				orderBy: { work_date: 'asc' },
				limit: 1
			})
		).rows;
		const contract = await hr.get('employment_contract', String(seed!.employment_id));
		const company_id = String(contract!.company_id);
		const number = String(contract!.employee_number);
		const from = iso(seed!.work_date);
		const to = addDays(from, 6);
		const context = { company_id, from, to };

		// the template follows the page: this entity, this week
		const template = (await run({ mode: 'template', context })) as { file: { id: string } };
		const [stored] = (
			await t.db.read([
				{ text: 'SELECT key FROM sys_file WHERE id = $1', params: [template.file.id] }
			])
		)[0]!.rows;
		const cells = await readSheet(t.fakes.files.blobs.get(String(stored!['key']))!);
		const header = cells[0]!;
		const col = (label: string) => header.indexOf(label);
		expect(header.slice(0, 3)).toEqual(['Employee number', 'Date', 'Shift']);
		// consent is planned: its column follows the overtime it covers
		expect(col('OT consent')).toBe(col('Overtime hours') + 1);
		const mine = cells.slice(1).filter((row) => row[col('Employee number')] === number);
		expect(mine.length).toBeGreaterThan(2);
		expect(
			cells
				.slice(1)
				.every((row) => String(row[col('Date')]) >= from && String(row[col('Date')]) <= to)
		).toBe(true);

		const unchanged = await run({
			mode: 'import',
			file: await upload([header, ...mine]),
			context,
			accept: true
		});
		expect(unchanged, JSON.stringify(unchanged)).toMatchObject({
			applied: true,
			created: 0,
			updated: 0,
			deleted: 0
		});

		// edit: blank a middle day with a shift, overtime on another, a leave code on a third
		const plain = (row: Cell[]) =>
			row[col('Leave')] == null &&
			row[col('Clock in')] == null &&
			row[col('Overtime hours')] == null;
		const middle = mine.slice(1, -1);
		const blank = middle.find((row) => row[col('Shift')] != null && plain(row));
		const overtime = middle.find((row) => row !== blank && row[col('Shift')] != null && plain(row));
		const leaveDay = middle.find((row) => row !== blank && row !== overtime && plain(row));
		expect(blank && overtime && leaveDay, 'the week has three plain middle days').toBeTruthy();
		// a leave class the entity already uses in that version
		const used = (
			await hr.read('leave_catalog_entry', {
				where: { employment_id: { eq: String(seed!.employment_id) }, activity: { eq: 'TIME_OFF' } },
				all: true
			})
		).rows;
		const classes = (await hr.read('leave_catalog', { all: true })).rows;
		const code = String(
			classes.find((row) => used.some((entry) => entry.catalog_id === row.id))?.code ?? ''
		);
		expect(code).not.toBe('');
		const editedWith = (leave: boolean) => [
			header,
			...mine.map((row) => {
				if (row === blank) return [row[0], row[1]];
				const out = [...row];
				if (row === overtime) out[col('Overtime hours')] = 1;
				if (leave && row === leaveDay) out[col('Leave')] = code;
				return out;
			})
		];
		const day = (row: Cell[] | undefined) => String(row![col('Date')]);
		const leaveOn = async () =>
			(
				await hr.read('leave_catalog_entry', {
					where: {
						employment_id: { eq: String(seed!.employment_id) },
						occurred_on: { eq: day(leaveDay) }
					},
					all: true
				})
			).rows.length;
		// The fixture week's plain days are a rest day, a holiday and an off day: a leave code there charges nothing
		// on the employment's own plan, so the server refuses it rather than charging a day.
		const refused = await run({
			mode: 'import',
			file: await upload(editedWith(true)),
			context,
			accept: true
		});
		expect(refused, JSON.stringify(refused)).toMatchObject({ applied: false });
		expect(JSON.stringify(refused)).toMatch(/charges nothing/);
		expect(await leaveOn()).toBe(0);

		const edited = editedWith(false);
		const set = await run({ mode: 'import', file: await upload(edited), context, accept: true });
		expect(set, JSON.stringify(set)).toMatchObject({ applied: true });
		const after = new Map(
			(
				await hr.read('roster_entry', {
					where: {
						employment_id: { eq: String(seed!.employment_id) },
						work_date: { gte: from, lte: to }
					},
					all: true
				})
			).rows.map((row) => [iso(row.work_date), row])
		);
		expect(after.has(day(blank))).toBe(false);
		expect(JSON.stringify(after.get(day(overtime))?.approved_overtime_hours)).toMatch(/"?1/);

		const again = await run({ mode: 'import', file: await upload(edited), context, accept: true });
		expect(again, JSON.stringify(again)).toMatchObject({
			applied: true,
			created: 0,
			updated: 0,
			deleted: 0
		});
	}
);

it.skipIf(!sample)(
	'OT consent round trip: the ID consent task is raised for overtime without consent, not for overtime with it',
	{ timeout: 600_000 },
	async () => {
		const t = await workspace({ sample: true, now: '2026-02-10T04:00:00.000Z' });
		const member = t.member(['hr_manager']);
		const hr = t.as(member);
		const run = (input: Record<string, unknown>) =>
			t.engine.pipelines.handlers()['roster_entry.pipeline']!(JSON.parse(JSON.stringify(input)), {
				id: randomUUID(),
				starter: member
			}) as Promise<Record<string, unknown>>;
		const upload = async (cells: readonly (readonly Cell[])[]) => {
			const out = await hr.upload('roster_entry.$import', {
				name: 'work-days.xlsx',
				mime: XLSX,
				bytes: await writeSheet(cells)
			});
			if (out.kind !== 'committed') throw new Error(JSON.stringify(out));
			return (out.output as { id: string }).id;
		};
		const [entity] = (
			await hr.read('entity', { where: { settings_code: { eq: 'ID' } }, all: true })
		).rows;
		const company_id = String(entity!.id);
		const contracts = (
			await hr.read('employment_contract', { where: { company_id: { eq: company_id } }, all: true })
		).rows;
		const [seed] = (
			await hr.read('roster_entry', {
				where: {
					employment_id: { in: contracts.map((row) => String(row.id)) },
					shift_definition_id: { isNull: false },
					approved_overtime_hours: { isNull: true },
					payslip_id: { isNull: true }
				},
				orderBy: { work_date: 'asc' },
				limit: 1
			})
		).rows;
		const employment_id = String(seed!.employment_id);
		const number = String(contracts.find((row) => row.id === employment_id)!.employee_number);
		const from = iso(seed!.work_date);
		const context = { company_id, from, to: addDays(from, 6) };
		const template = (await run({ mode: 'template', context })) as { file: { id: string } };
		const [stored] = (
			await t.db.read([
				{ text: 'SELECT key FROM sys_file WHERE id = $1', params: [template.file.id] }
			])
		)[0]!.rows;
		const cells = await readSheet(t.fakes.files.blobs.get(String(stored!['key']))!);
		const header = cells[0]!;
		const col = (label: string) => header.indexOf(label);
		const mine = cells.slice(1).filter((row) => row[col('Employee number')] === number);
		// two stored planned days with nothing else on them: overtime on both, consent on one
		const plain = mine.filter(
			(row) =>
				row[col('Shift')] != null &&
				row[col('Leave')] == null &&
				row[col('Overtime hours')] == null &&
				row[col('OT consent')] == null
		);
		const [without, consented] = plain;
		expect(without && consented, 'the week has two plain planned days').toBeTruthy();
		const edited = [
			header,
			...mine.map((row) => {
				const out = [...row];
				while (out.length < header.length) out.push(null);
				if (row === without || row === consented) out[col('Overtime hours')] = 1;
				if (row === consented) out[col('OT consent')] = 'Y';
				return out;
			})
		];
		const set = await run({ mode: 'import', file: await upload(edited), context, accept: true });
		expect(set, JSON.stringify(set)).toMatchObject({ applied: true });
		await t.runDue();
		await t.settled();
		const day = (row: Cell[] | undefined) => String(row![col('Date')]);
		const days = new Map(
			(
				await hr.read('roster_entry', {
					where: {
						employment_id: { eq: employment_id },
						work_date: { gte: from, lte: context.to }
					},
					all: true
				})
			).rows.map((row) => [iso(row.work_date), row])
		);
		expect(days.get(day(without))?.overtime_consented_at ?? null).toBeNull();
		expect(days.get(day(consented))?.overtime_consented_at).not.toBeNull();
		const raised = new Set(
			(
				await hr.read('regulatory_task', {
					where: { code: { eq: 'OVERTIME_WRITTEN_ORDER' } },
					all: true
				})
			).rows.map((row) => String(row.subject_id))
		);
		expect(raised.has(String(days.get(day(without))!.id))).toBe(true);
		expect(raised.has(String(days.get(day(consented))!.id))).toBe(false);

		// the template now prefills the consent; re-imported unchanged it writes nothing
		const again = (await run({ mode: 'template', context })) as { file: { id: string } };
		const [file] = (
			await t.db.read([{ text: 'SELECT key FROM sys_file WHERE id = $1', params: [again.file.id] }])
		)[0]!.rows;
		const restated = (await readSheet(t.fakes.files.blobs.get(String(file!['key']))!)).filter(
			(row, i) => i === 0 || row[col('Employee number')] === number
		);
		expect(
			restated.find((row) => String(row[col('Date')]) === day(consented))?.[col('OT consent')]
		).toBe(day(consented));
		const unchanged = await run({
			mode: 'import',
			file: await upload(restated),
			context,
			accept: true
		});
		expect(unchanged, JSON.stringify(unchanged)).toMatchObject({
			applied: true,
			created: 0,
			updated: 0,
			deleted: 0
		});
	}
);
