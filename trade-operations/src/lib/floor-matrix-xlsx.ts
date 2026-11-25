import { BigDecimal, Effect, Option, Schema } from 'effect';
import { zip } from './xlsx.js';

export const FLOOR_MATRIX_SHEET = '每日基准价格汇总';
export const FLOOR_STAMP_SHEET = '模板信息';
const STAMP_LABEL = '导出时间';
const HEADERS = ['商品编码', '规格', '品牌', '类别', '分类', '最近报价', '库位'] as const;
const CODE_HEADER = '商品编码';
const GROUP_HEADER = '库位';
const NO_CHANGE = new Set(['/', '／']);

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;
const EXCEL_SERIAL_FLOOR = 61;
const EXCEL_SERIAL_CEILING = 2_958_465;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;
const SLASH_DAY_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const ZH_DAY_RE = /^(\d{1,2})月(\d{1,2})日$/;

export type FloorMatrixErrorCode = 'unreadable' | 'mismatch' | 'wrong_month';

export class FloorMatrixError extends Schema.TaggedError<FloorMatrixError>()('FloorMatrixError', {
	code: Schema.Literals(['unreadable', 'mismatch', 'wrong_month']),
	message: Schema.String
}) {}

export type FloorMatrixExportRow = {
	readonly code: string;
	readonly spec?: string | null;
	readonly brand?: string | null;
	readonly category?: string | null;
	readonly groupLabel: string;
	readonly latestPrice?: string | null;
	readonly cells: Readonly<Record<string, string>>;
};

export type ParsedFloorCell = {
	/** 1-based worksheet row number (header is row 1). */
	readonly rowNo: number;
	readonly code: string;
	readonly group: string;
	readonly date: string;
	readonly price: string;
};

export type ParsedFloorMatrix = {
	readonly cells: readonly ParsedFloorCell[];
	readonly stamp: string | null;
	readonly months: readonly string[];
	readonly invalid: readonly {
		readonly rowNo: number;
		readonly column: string;
		readonly raw: string;
	}[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const xmlEscape = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');

const ENTITY: Readonly<Record<string, string>> = {
	lt: '<',
	gt: '>',
	amp: '&',
	quot: '"',
	apos: "'"
};

const xmlUnescape = (value: string) =>
	value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, entity: string) =>
		entity[0] === '#'
			? String.fromCodePoint(
					entity[1] === 'x' || entity[1] === 'X'
						? parseInt(entity.slice(2), 16)
						: Number(entity.slice(1))
				)
			: (ENTITY[entity] ?? all)
	);

const columnName = (index: number): string => {
	let name = '';
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
		name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
	return name;
};

const columnIndex = (ref: string): number => {
	let index = 0;
	for (let i = 0; i < ref.length; i++) {
		const code = ref.charCodeAt(i);
		if (code < 65 || code > 90) break;
		index = index * 26 + (code - 64);
	}
	return index - 1;
};

const pad = (n: number, width: number) => String(n).padStart(width, '0');

const validCalendarDay = (year: number, month: number, day: number): string | null => {
	if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
	const dt = new Date(Date.UTC(2000, month - 1, day));
	dt.setUTCFullYear(year);
	if (
		Number.isNaN(dt.getTime()) ||
		dt.getUTCFullYear() !== year ||
		dt.getUTCMonth() !== month - 1 ||
		dt.getUTCDate() !== day
	)
		return null;
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
};

export const dayToExcelSerial = (day: string): number => {
	const match = ISO_DAY_RE.exec(day);
	if (!match) throw new Error(`Invalid day: ${day}`);
	const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	return Math.round((utc - EXCEL_EPOCH) / MS_PER_DAY);
};

export const excelSerialToDay = (serial: number): string | null => {
	if (!Number.isFinite(serial)) return null;
	const whole = Math.floor(serial);
	if (whole < EXCEL_SERIAL_FLOOR || whole > EXCEL_SERIAL_CEILING) return null;
	const dt = new Date(EXCEL_EPOCH + whole * MS_PER_DAY);
	return validCalendarDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

const parseDayHeader = (cell: CellValue, expectedMonth?: string): string | null => {
	if (cell === null) return null;
	if (typeof cell === 'number') return excelSerialToDay(cell);
	if (typeof cell !== 'string') return null;
	const trimmed = cell.trim();
	if (trimmed === '') return null;
	const iso = ISO_DAY_RE.exec(trimmed);
	if (iso) return validCalendarDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
	const slash = SLASH_DAY_RE.exec(trimmed);
	if (slash) return validCalendarDay(Number(slash[1]), Number(slash[2]), Number(slash[3]));
	const zh = ZH_DAY_RE.exec(trimmed);
	if (zh && expectedMonth) {
		const year = Number(expectedMonth.slice(0, 4));
		return validCalendarDay(year, Number(zh[1]), Number(zh[2]));
	}
	if (/^\d+(?:\.\d+)?$/.test(trimmed)) return excelSerialToDay(Number(trimmed));
	return null;
};

type CellValue = string | number | boolean | null;

const inflateRaw = (name: string, data: Uint8Array) =>
	Effect.tryPromise({
		try: async () => {
			const stream = new Blob([new Uint8Array(data)])
				.stream()
				.pipeThrough(new DecompressionStream('deflate-raw'));
			const reader = stream.getReader();
			const chunks: Uint8Array[] = [];
			let total = 0;
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				total += value.byteLength;
				if (total > MAX_ENTRY_BYTES) throw new Error(`${name} exceeds unpacked limit`);
				chunks.push(value);
			}
			const out = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				out.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return out;
		},
		catch: () =>
			new FloorMatrixError({
				code: 'unreadable',
				message: 'The uploaded file is not a readable .xlsx workbook.'
			})
	});

const readZipEntries = (bytes: Uint8Array) =>
	Effect.gen(function* () {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let eocd = bytes.length - 22;
		while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
		if (eocd < 0)
			return yield* Effect.fail(
				new FloorMatrixError({
					code: 'unreadable',
					message: 'The uploaded file is not a readable .xlsx workbook.'
				})
			);
		const entries = new Map<string, () => Effect.Effect<string, FloorMatrixError>>();
		const count = view.getUint16(eocd + 10, true);
		let at = view.getUint32(eocd + 16, true);
		for (let i = 0; i < count; i++) {
			if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
				return yield* Effect.fail(
					new FloorMatrixError({
						code: 'unreadable',
						message: 'The uploaded file is not a readable .xlsx workbook.'
					})
				);
			const method = view.getUint16(at + 10, true);
			const compressed = view.getUint32(at + 20, true);
			const nameLen = view.getUint16(at + 28, true);
			const extraLen = view.getUint16(at + 30, true);
			const commentLen = view.getUint16(at + 32, true);
			const localOffset = view.getUint32(at + 42, true);
			const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
			at += 46 + nameLen + extraLen + commentLen;
			entries.set(name, () =>
				Effect.gen(function* () {
					if (localOffset + 30 > bytes.length)
						return yield* Effect.fail(
							new FloorMatrixError({
								code: 'unreadable',
								message: 'The uploaded file is not a readable .xlsx workbook.'
							})
						);
					const localNameLen = view.getUint16(localOffset + 26, true);
					const localExtraLen = view.getUint16(localOffset + 28, true);
					const start = localOffset + 30 + localNameLen + localExtraLen;
					const raw = bytes.subarray(start, start + compressed);
					if (method === 0) return decoder.decode(raw);
					if (method === 8) return decoder.decode(yield* inflateRaw(name, raw));
					return yield* Effect.fail(
						new FloorMatrixError({
							code: 'unreadable',
							message: 'The uploaded file uses an unsupported ZIP compression method.'
						})
					);
				})
			);
		}
		return entries;
	});

const attr = (xml: string, name: string): string | undefined =>
	new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(xml)?.[1];

const extractTexts = (xml: string): string =>
	xmlUnescape(
		[...xml.matchAll(/<(?:[\w.-]+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:[\w.-]+:)?t>/g)]
			.map((m) => m[1] ?? '')
			.join('')
	);

const parseSheetRows = (sheetXml: string, shared: readonly string[]): CellValue[][] => {
	const rows: CellValue[][] = [];
	for (const rowMatch of sheetXml.matchAll(
		/<(?:[\w.-]+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?row>)/g
	)) {
		const rAttr = attr(rowMatch[1] ?? '', 'r');
		const rowIdx = rAttr ? Number(rAttr) - 1 : rows.length;
		while (rows.length < rowIdx) rows.push([]);
		const row: CellValue[] = [];
		const body = rowMatch[2] ?? '';
		for (const cellMatch of body.matchAll(
			/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g
		)) {
			const attrs = cellMatch[1] ?? '';
			const inner = cellMatch[2] ?? '';
			const ref = attr(attrs, 'r');
			const colIdx = ref ? columnIndex(ref) : row.length;
			while (row.length < colIdx) row.push(null);
			const type = attr(attrs, 't');
			let value: CellValue = null;
			if (type === 'inlineStr') {
				value = extractTexts(inner);
			} else {
				const vMatch = /<(?:[\w.-]+:)?v(?:\s[^>]*)?>([^<]*)<\/(?:[\w.-]+:)?v>/.exec(inner);
				const raw = vMatch?.[1];
				if (raw !== undefined) {
					if (type === 's') value = shared[Number(raw)] ?? '';
					else if (type === 'str') value = xmlUnescape(raw);
					else if (type === 'b') value = raw === '1';
					else if (type !== 'e') {
						const num = Number(raw);
						value = Number.isFinite(num) ? num : xmlUnescape(raw);
					}
				}
			}
			row[colIdx] = value;
		}
		rows[rowIdx] = row;
	}
	return rows;
};

const cellText = (value: CellValue | undefined): string => {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value.trim();
	return String(value).trim();
};

/**
 * Parses a SalesBridge `每日基准价格汇总` `.xlsx` workbook.
 * Accepts both the 7-column layout (`商品编码`, `规格`, `品牌`, `类别`, `分类`, `最近报价`, `库位`, days…)
 * and the minimal 2-column layout (`商品编码`, `库位`, days…). Blank cells and `/` (`／`) mean unchanged.
 */
export const parseFloorMatrixXlsx = (bytes: Uint8Array, expectedMonth?: string) =>
	Effect.gen(function* () {
		const entries = yield* readZipEntries(bytes);
		const readText = (path: string) => entries.get(path)?.() ?? Effect.succeed('');
		const workbookXml = yield* readText('xl/workbook.xml');
		if (!workbookXml)
			return yield* Effect.fail(
				new FloorMatrixError({
					code: 'unreadable',
					message: 'The uploaded file is not a readable .xlsx workbook.'
				})
			);
		const relsXml = yield* readText('xl/_rels/workbook.xml.rels');
		const rels = [...relsXml.matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*?)\/?\s*>/g)].map((m) => ({
			id: attr(m[1] ?? '', 'Id'),
			target: attr(m[1] ?? '', 'Target')
		}));
		const sheets = [...workbookXml.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*?)\/?\s*>/g)].map(
			(m, idx) => {
				const attrs = m[1] ?? '';
				const name = xmlUnescape(attr(attrs, 'name') ?? `Sheet ${idx + 1}`);
				const target = rels.find((r) => r.id === attr(attrs, '[\\w.-]+:id'))?.target;
				return {
					name,
					path: target?.replace(/^\/?(xl\/)?/, 'xl/') ?? `xl/worksheets/sheet${idx + 1}.xml`
				};
			}
		);
		const mainSheet = sheets.find((s) => s.name === FLOOR_MATRIX_SHEET) ?? sheets[0];
		if (!mainSheet)
			return yield* Effect.fail(
				new FloorMatrixError({
					code: 'unreadable',
					message: 'The workbook contains no worksheets.'
				})
			);
		const sharedXml = yield* readText('xl/sharedStrings.xml');
		const shared = [
			...sharedXml.matchAll(/<(?:[\w.-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?si>/g)
		].map((m) => extractTexts(m[1] ?? ''));
		const mainXml = yield* readText(mainSheet.path);
		const rows = parseSheetRows(mainXml, shared);
		const header = rows[0] ?? [];
		const codeColumn = header.findIndex((c) => cellText(c) === CODE_HEADER);
		const groupColumn = header.findIndex((c) => cellText(c) === GROUP_HEADER);
		if (codeColumn === -1 || groupColumn === -1 || groupColumn <= codeColumn)
			return yield* Effect.fail(
				new FloorMatrixError({
					code: 'mismatch',
					message: 'Header mismatch: expected columns 商品编码 and 库位 followed by day columns.'
				})
			);
		const days: (string | null)[] = [];
		const months = new Set<string>();
		let validDayCount = 0;
		for (let col = groupColumn + 1; col < header.length; col++) {
			const rawHeader = header[col] ?? null;
			if (cellText(rawHeader) === '') {
				days.push(null);
				continue;
			}
			const parsed = parseDayHeader(rawHeader, expectedMonth);
			if (parsed === null)
				return yield* Effect.fail(
					new FloorMatrixError({
						code: 'mismatch',
						message: `Unrecognized day column header: ${cellText(rawHeader)}`
					})
				);
			const month = parsed.slice(0, 7);
			if (expectedMonth && month !== expectedMonth)
				return yield* Effect.fail(
					new FloorMatrixError({
						code: 'wrong_month',
						message: `Workbook day ${parsed} does not match selected month ${expectedMonth}.`
					})
				);
			months.add(month);
			days.push(parsed);
			validDayCount++;
		}
		if (validDayCount === 0)
			return yield* Effect.fail(
				new FloorMatrixError({
					code: 'mismatch',
					message: 'No day columns found after 库位.'
				})
			);
		const cells: ParsedFloorCell[] = [];
		const invalid: { readonly rowNo: number; readonly column: string; readonly raw: string }[] = [];
		let carryCode = '';
		for (let i = 1; i < rows.length; i++) {
			const row = rows[i] ?? [];
			const rowCode = cellText(row[codeColumn]);
			if (rowCode !== '') carryCode = rowCode;
			const group = cellText(row[groupColumn]);
			for (let d = 0; d < days.length; d++) {
				const date = days[d];
				if (!date) continue;
				const rawCell = row[groupColumn + 1 + d];
				const typed = cellText(rawCell);
				if (typed === '' || NO_CHANGE.has(typed)) continue;
				const parsedPrice = Option.getOrNull(BigDecimal.fromString(typed));
				if (
					!/^\d+(?:\.\d{1,4})?$/.test(typed) ||
					parsedPrice === null ||
					!BigDecimal.isPositive(parsedPrice)
				) {
					invalid.push({ rowNo: i + 1, column: date, raw: typed });
					continue;
				}
				cells.push({
					rowNo: i + 1,
					code: carryCode,
					group,
					date,
					price: BigDecimal.format(parsedPrice)
				});
			}
		}
		let stamp: string | null = null;
		const stampSheet = sheets.find((s) => s.name === FLOOR_STAMP_SHEET);
		if (stampSheet) {
			const stampRows = parseSheetRows(yield* readText(stampSheet.path), shared);
			const found = stampRows.find((r) => cellText(r[0]) === STAMP_LABEL);
			const candidate = cellText(found?.[1]);
			if (STAMP_RE.test(candidate)) stamp = candidate;
		}
		return {
			cells,
			stamp,
			months: [...months].sort(),
			invalid
		} satisfies ParsedFloorMatrix;
	});

const inlineStringCell = (ref: string, text: string) =>
	text === ''
		? ''
		: `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;

const numericCell = (ref: string, value: string | number, style?: number) =>
	`<c r="${ref}"${style !== undefined ? ` s="${style}"` : ''}><v>${value}</v></c>`;

/**
 * Builds a SalesBridge-format `每日基准价格汇总` `.xlsx` workbook for one month,
 * with `m"月"d"日"` date headers and an optional hidden `模板信息` export-timestamp sheet.
 */
export function buildFloorMatrixXlsx(
	days: readonly string[],
	rows: readonly FloorMatrixExportRow[],
	options: { readonly stamp?: string } = {}
): Uint8Array<ArrayBuffer> {
	const headerCells = [
		...HEADERS.map((label, idx) => inlineStringCell(`${columnName(idx)}1`, label)),
		...days.map((day, idx) =>
			numericCell(`${columnName(HEADERS.length + idx)}1`, dayToExcelSerial(day), 1)
		)
	].join('');
	const bodyRows = rows
		.map((row, rowIndex) => {
			const r = rowIndex + 2;
			const parts = [
				inlineStringCell(`${columnName(0)}${r}`, row.code),
				inlineStringCell(`${columnName(1)}${r}`, row.spec ?? ''),
				inlineStringCell(`${columnName(2)}${r}`, row.brand ?? ''),
				inlineStringCell(`${columnName(3)}${r}`, row.category ?? ''),
				inlineStringCell(`${columnName(4)}${r}`, ''),
				row.latestPrice ? numericCell(`${columnName(5)}${r}`, row.latestPrice) : '',
				inlineStringCell(`${columnName(6)}${r}`, row.groupLabel),
				...days.map((day, d) => {
					const value = row.cells[day];
					return value ? numericCell(`${columnName(HEADERS.length + d)}${r}`, value) : '';
				})
			].join('');
			return `<row r="${r}">${parts}</row>`;
		})
		.join('');
	const mainSheetXml =
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
		`<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane xSplit="${HEADERS.length}" ySplit="1" topLeftCell="${columnName(HEADERS.length)}2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` +
		`<sheetData><row r="1">${headerCells}</row>${bodyRows}</sheetData></worksheet>`;
	const stylesXml =
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
		`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
		`<numFmts count="1"><numFmt numFmtId="164" formatCode="m&quot;月&quot;d&quot;日&quot;"/></numFmts>` +
		`<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
		`<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
		`<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
		`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
		`<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
		`</styleSheet>`;
	const hasStamp = options.stamp !== undefined && STAMP_RE.test(options.stamp);
	const stampSheetXml = hasStamp
		? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
			`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
			`<row r="1">${inlineStringCell('A1', STAMP_LABEL)}${inlineStringCell('B1', options.stamp ?? '')}</row>` +
			`</sheetData></worksheet>`
		: null;
	const entries: { readonly name: string; readonly text: string }[] = [
		{
			name: '[Content_Types].xml',
			text:
				`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
				`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
				`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
				`<Default Extension="xml" ContentType="application/xml"/>` +
				`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
				`<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
				`<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
				(hasStamp
					? `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
					: '') +
				`</Types>`
		},
		{
			name: '_rels/.rels',
			text:
				`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
				`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
				`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
				`</Relationships>`
		},
		{
			name: 'xl/workbook.xml',
			text:
				`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
				`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
				`<sheet name="${xmlEscape(FLOOR_MATRIX_SHEET)}" sheetId="1" r:id="rId1"/>` +
				(hasStamp
					? `<sheet name="${xmlEscape(FLOOR_STAMP_SHEET)}" sheetId="2" state="hidden" r:id="rId2"/>`
					: '') +
				`</sheets></workbook>`
		},
		{
			name: 'xl/_rels/workbook.xml.rels',
			text:
				`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
				`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
				`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
				(hasStamp
					? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>`
					: '') +
				`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
				`</Relationships>`
		},
		{ name: 'xl/styles.xml', text: stylesXml },
		{ name: 'xl/worksheets/sheet1.xml', text: mainSheetXml },
		...(stampSheetXml ? [{ name: 'xl/worksheets/sheet2.xml', text: stampSheetXml }] : [])
	];
	return zip(entries.map(({ name, text }) => ({ name, bytes: encoder.encode(text) })));
}
