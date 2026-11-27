import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import {
	buildFloorMatrixXlsx,
	dayToExcelSerial,
	FLOOR_MATRIX_SHEET,
	FLOOR_STAMP_SHEET,
	parseFloorMatrixXlsx
} from '../src/lib/floor-matrix-xlsx.js';
import {
	buildFloorMatrixExportRows,
	monthDays,
	planFloorMatrixImport,
	priceBookExportMonthRead,
	priceBookExportPriorRead,
	priceBookImportFloorsRead,
	priceBookImportProductsRead
} from '../src/lib/price-book.js';
import { zip } from '../src/lib/xlsx.js';
import { PRODUCT, workspace } from './kit.js';
import { sameDecimal } from './test-runtime.js';

const encoder = new TextEncoder();

const deflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
	const stream = new Blob([new Uint8Array(data)])
		.stream()
		.pipeThrough(new CompressionStream('deflate-raw'));
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.byteLength;
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.byteLength;
	}
	return out;
};

/** Builds a minimal DEFLATE-compressed .xlsx ZIP (matching Excel/ExcelJS output). */
const deflateZip = async (files: readonly { readonly name: string; readonly text: string }[]) => {
	const stored = zip(files.map(({ name, text }) => ({ name, bytes: encoder.encode(text) })));
	// Re-pack with method=8 (deflate) so we exercise DecompressionStream('deflate-raw').
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	const CRC = (() => {
		const t = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			t[n] = c >>> 0;
		}
		return t;
	})();
	const crc32 = (b: Uint8Array) => {
		let c = 0xffffffff;
		for (const byte of b) c = (CRC[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	let offset = 0;
	for (const file of files) {
		const name = encoder.encode(file.name);
		const raw = encoder.encode(file.text);
		const comp = await deflateRaw(raw);
		const crc = crc32(raw);
		const lh = new Uint8Array(30 + name.length);
		const lv = new DataView(lh.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(8, 8, true); // DEFLATE
		lv.setUint32(14, crc, true);
		lv.setUint32(18, comp.length, true);
		lv.setUint32(22, raw.length, true);
		lv.setUint16(26, name.length, true);
		lh.set(name, 30);
		local.push(lh, comp);
		const ch = new Uint8Array(46 + name.length);
		const cv = new DataView(ch.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(10, 8, true); // DEFLATE
		cv.setUint32(16, crc, true);
		cv.setUint32(20, comp.length, true);
		cv.setUint32(24, raw.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		ch.set(name, 46);
		central.push(ch);
		offset += lh.length + comp.length;
	}
	const dirSize = central.reduce((s, e) => s + e.length, 0);
	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, files.length, true);
	ev.setUint16(10, files.length, true);
	ev.setUint32(12, dirSize, true);
	ev.setUint32(16, offset, true);
	const parts = [...local, ...central, eocd];
	const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	expect(stored.byteLength).toBeGreaterThan(0);
	return out;
};

it.effect('round-trips SalesBridge 每日基准价格汇总 .xlsx with stamp and date serial headers', () =>
	Effect.gen(function* () {
		const days = monthDays('2026-10');
		const bytes = buildFloorMatrixXlsx(
			days,
			[
				{
					code: 'RESIN-A',
					spec: 'SG-3',
					brand: 'BrandA',
					category: 'PVC',
					groupLabel: '华东仓',
					latestPrice: '21500',
					cells: { '2026-10-01': '21500', '2026-10-15': '22100.5' }
				}
			],
			{ stamp: '2026-10-16T08:30:00.000Z' }
		);
		const parsed = yield* parseFloorMatrixXlsx(bytes, '2026-10');
		expect(parsed.stamp).toBe('2026-10-16T08:30:00.000Z');
		expect(parsed.months).toEqual(['2026-10']);
		expect(parsed.invalid).toEqual([]);
		expect(parsed.cells).toEqual([
			{ rowNo: 2, code: 'RESIN-A', group: '华东仓', date: '2026-10-01', price: '21500' },
			{ rowNo: 2, code: 'RESIN-A', group: '华东仓', date: '2026-10-15', price: '22100.5' }
		]);
		const wrongMonth = yield* Effect.flip(parseFloorMatrixXlsx(bytes, '2026-11'));
		expect(wrongMonth).toMatchObject({ _tag: 'FloorMatrixError', code: 'wrong_month' });
	})
);

it.live(
	'parses DEFLATE-compressed minimal 2-column workbook with merged SKU carry-down, slash skips and invalid cells',
	() =>
		Effect.gen(function* () {
			const serial1 = dayToExcelSerial('2026-10-01');
			const serial2 = dayToExcelSerial('2026-10-02');
			const sheetXml =
				`<?xml version="1.0" encoding="UTF-8"?>` +
				`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
				`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>${serial1}</v></c><c r="D1"><v>${serial2}</v></c></row>` +
				`<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>21000</v></c><c r="D2" t="inlineStr"><is><t>/</t></is></c></row>` +
				`<row r="3"><c r="B3" t="s"><v>4</v></c><c r="C3" t="inlineStr"><is><t>／</t></is></c><c r="D3"><v>22000.25</v></c></row>` +
				`<row r="4"><c r="B4" t="s"><v>4</v></c><c r="C4"><v>-5</v></c></row>` +
				`</sheetData></worksheet>`;
			const sharedXml =
				`<?xml version="1.0" encoding="UTF-8"?>` +
				`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">` +
				`<si><t>商品编码</t></si><si><t>库位</t></si><si><t>RESIN-A</t></si><si><t>华东仓</t></si><si><t>华南仓</t></si>` +
				`</sst>`;
			const stampXml =
				`<?xml version="1.0" encoding="UTF-8"?>` +
				`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
				`<row r="1"><c r="A1" t="inlineStr"><is><t>导出时间</t></is></c><c r="B1" t="inlineStr"><is><t>2026-10-02T00:00:00Z</t></is></c></row>` +
				`</sheetData></worksheet>`;
			const bytes = yield* Effect.promise(() =>
				deflateZip([
					{
						name: 'xl/workbook.xml',
						text: `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${FLOOR_MATRIX_SHEET}" sheetId="1" r:id="rId1"/><sheet name="${FLOOR_STAMP_SHEET}" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`
					},
					{
						name: 'xl/_rels/workbook.xml.rels',
						text: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`
					},
					{ name: 'xl/sharedStrings.xml', text: sharedXml },
					{ name: 'xl/worksheets/sheet1.xml', text: sheetXml },
					{ name: 'xl/worksheets/sheet2.xml', text: stampXml }
				])
			);
			const parsed = yield* parseFloorMatrixXlsx(bytes, '2026-10');
			expect(parsed.stamp).toBe('2026-10-02T00:00:00Z');
			expect(parsed.cells).toEqual([
				{ rowNo: 2, code: 'RESIN-A', group: '华东仓', date: '2026-10-01', price: '21000' },
				{ rowNo: 3, code: 'RESIN-A', group: '华南仓', date: '2026-10-02', price: '22000.25' }
			]);
			expect(parsed.invalid).toEqual([{ rowNo: 4, column: '2026-10-01', raw: '-5' }]);
		})
);

it.live(
	'exports and uploads SalesBridge .xlsx matrix with group_name matching, staleness protection, and 1-price-per-day upsert',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const actor = yield* t.as(t.member(['configuration']));
			// Assign a region name (库位) on the seeded WEST warehouse
			yield* t.db.write({
				text: "UPDATE warehouses SET group_name = '华东仓' WHERE group_code = 'WEST'",
				params: []
			});
			yield* actor.act({
				'pricing_floors.create': [
					{
						product: PRODUCT,
						group_code: 'WEST',
						currency: 'CNY',
						effective_on: '2026-10-01',
						unit: '吨',
						floor_price: '21000',
						tax_inclusive: true,
						tax_rate: '13'
					}
				]
			});
			const warehouses = (yield* actor.query({
				warehouses: { fields: ['name', 'group_code', 'group_name', 'active'] }
			})).warehouses.rows;
			const monthAnswer = yield* actor.query(priceBookExportMonthRead('CNY', '2026-10'));
			const priorAnswer = yield* actor.query(priceBookExportPriorRead('CNY', '2026-10'));
			const exportRows = buildFloorMatrixExportRows({
				month: '2026-10',
				warehouses,
				products: monthAnswer.products.rows,
				monthFloors: monthAnswer.pricing_floors.rows,
				priorFloors: priorAnswer.pricing_floors.rows
			});
			expect(exportRows).toMatchObject([
				{
					code: 'RESIN-A',
					groupLabel: '华东仓',
					latestPrice: '21000',
					cells: { '2026-10-01': '21000' }
				}
			]);

			const firstExport = exportRows[0];
			if (!firstExport) throw new Error('Expected exported row');

			// Edit exported workbook: keep 2026-10-01 unchanged, update 2026-10-02 to 21500
			const editedBytes = buildFloorMatrixXlsx(
				monthDays('2026-10'),
				[
					{
						...firstExport,
						cells: { '2026-10-01': '21000', '2026-10-02': '21500' }
					}
				],
				{ stamp: '2099-01-01T00:00:00.000Z' }
			);
			const parsed = yield* parseFloorMatrixXlsx(editedBytes, '2026-10');
			const products = (yield* actor.query(priceBookImportProductsRead(['RESIN-A']))).products.rows;
			const existing = (yield* actor.query(
				priceBookImportFloorsRead(
					'CNY',
					products.map((p) => p.id)
				)
			)).pricing_floors.rows;
			const plan = planFloorMatrixImport({
				parsed,
				currency: 'CNY',
				warehouses,
				knownGroups: ['WEST'],
				products,
				existing
			});
			expect(plan.issues).toEqual([]);
			expect(plan.unchanged).toBe(1);
			expect(plan.rows).toEqual([
				{
					product: PRODUCT,
					group_code: 'WEST',
					currency: 'CNY',
					effective_on: '2026-10-02',
					unit: '吨',
					floor_price: '21500',
					tax_inclusive: true,
					tax_rate: '13'
				}
			]);
			yield* actor.act({
				'pricing_floors.import': { rows: plan.rows, on_conflict: 'update' }
			});

			// A stale workbook (older stamp than existing row updated_at) modifying 2026-10-02 is refused
			const staleBytes = buildFloorMatrixXlsx(
				monthDays('2026-10'),
				[{ ...firstExport, cells: { '2026-10-02': '20000' } }],
				{ stamp: '2020-01-01T00:00:00.000Z' }
			);
			const parsedStale = yield* parseFloorMatrixXlsx(staleBytes, '2026-10');
			const existingAfter = (yield* actor.query(
				priceBookImportFloorsRead(
					'CNY',
					products.map((p) => p.id)
				)
			)).pricing_floors.rows;
			const stalePlan = planFloorMatrixImport({
				parsed: parsedStale,
				currency: 'CNY',
				warehouses,
				knownGroups: ['WEST'],
				products,
				existing: existingAfter
			});
			expect(stalePlan.issues).toMatchObject([{ rowNo: 2, column: '2026-10-02', reason: 'stale' }]);

			// Upserting the same day overwrites in place (strictly 1 price per SKU/region/currency/day)
			yield* actor.act({
				'pricing_floors.import': {
					rows: [
						{
							product: PRODUCT,
							group_code: 'WEST',
							currency: 'CNY',
							effective_on: '2026-10-02',
							unit: '吨',
							floor_price: '21800',
							tax_inclusive: true,
							tax_rate: '13'
						}
					],
					on_conflict: 'update'
				}
			});
			const finalRows = (yield* actor.query({
				pricing_floors: {
					where: { group_code: { eq: 'WEST' }, effective_on: { eq: '2026-10-02' } }
				}
			})).pricing_floors.rows;
			expect(finalRows).toHaveLength(1);
			expect(sameDecimal(finalRows[0]?.floor_price, '21800')).toBe(true);

			// Uploading a brand-new floor for a KG product without prior floors defaults to '吨', never 'KG'
			const freshPlan = planFloorMatrixImport({
				parsed: {
					stamp: null,
					months: ['2026-10'],
					invalid: [],
					cells: [
						{ rowNo: 2, code: 'RESIN-A', group: '华东仓', date: '2026-10-05', price: '19800' }
					]
				},
				currency: 'CNY',
				warehouses,
				knownGroups: ['WEST'],
				products: [
					{
						id: PRODUCT,
						external_code: 'RESIN-A',
						source_number: 'RESIN-A',
						unit: 'KG',
						tax_rate: '13',
						active: true
					}
				],
				existing: []
			});
			expect(freshPlan.issues).toEqual([]);
			expect(freshPlan.rows).toMatchObject([{ unit: '吨', floor_price: '19800' }]);
		})
);
