/** A minimal on-demand XLSX writer: one inline-string sheet, no dependencies, no stored file. */
export type XlsxColumn = {
	readonly field: string;
	readonly label?: string;
	readonly numeric?: boolean;
	readonly scale?: number;
};
type Cell = string | number | boolean | null | undefined;

const encoder = new TextEncoder();
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();
const crc32 = (bytes: Uint8Array) => {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const xml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
const columnName = (index: number) => {
	let name = '';
	for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
		name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
	return name;
};
const number = (value: Cell) => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (value === null || value === undefined || typeof value === 'boolean') return null;
	const parsed = Number(String(value).trim());
	return Number.isFinite(parsed) ? parsed : null;
};
const cellXml = (
	reference: string,
	value: Cell,
	column?: { readonly numeric?: boolean; readonly scale?: number }
) => {
	if (value === null || value === undefined) return '';
	const numeric = column?.numeric ? number(value) : null;
	if (numeric !== null && typeof value !== 'boolean')
		return `<c r="${reference}"><v>${column?.scale === undefined ? numeric : numeric.toFixed(column.scale)}</v></c>`;
	const text = typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
	return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
};
const sheetXml = (
	columns: readonly XlsxColumn[],
	rows: readonly { readonly [field: string]: unknown }[]
) => {
	const header = columns
		.map((column, index) => cellXml(`${columnName(index)}1`, column.label ?? column.field))
		.join('');
	const body = rows
		.map((row, rowIndex) =>
			columns
				.map((column, columnIndex) =>
					cellXml(`${columnName(columnIndex)}${rowIndex + 2}`, row[column.field] as Cell, column)
				)
				.join('')
		)
		.map((cells, rowIndex) => `<row r="${rowIndex + 2}">${cells}</row>`)
		.join('');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`;
};
const zipped = (files: readonly { readonly name: string; readonly text: string }[]) => {
	const local: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;
	for (const file of files) {
		const name = encoder.encode(file.name);
		const data = encoder.encode(file.text);
		const crc = crc32(data);
		const header = new Uint8Array(30 + name.length);
		const view = new DataView(header.buffer);
		view.setUint32(0, 0x04034b50, true);
		view.setUint16(4, 20, true);
		view.setUint16(6, 0, true);
		view.setUint16(8, 0, true);
		view.setUint16(10, 0, true);
		view.setUint16(12, 0x21, true);
		view.setUint32(14, crc, true);
		view.setUint32(18, data.length, true);
		view.setUint32(22, data.length, true);
		view.setUint16(26, name.length, true);
		view.setUint16(28, 0, true);
		header.set(name, 30);
		local.push(header, data);
		const entry = new Uint8Array(46 + name.length);
		const entryView = new DataView(entry.buffer);
		entryView.setUint32(0, 0x02014b50, true);
		entryView.setUint16(4, 20, true);
		entryView.setUint16(6, 20, true);
		entryView.setUint16(8, 0, true);
		entryView.setUint16(10, 0, true);
		entryView.setUint16(12, 0, true);
		entryView.setUint16(14, 0x21, true);
		entryView.setUint32(16, crc, true);
		entryView.setUint32(20, data.length, true);
		entryView.setUint32(24, data.length, true);
		entryView.setUint16(28, name.length, true);
		entryView.setUint16(30, 0, true);
		entryView.setUint16(32, 0, true);
		entryView.setUint16(34, 0, true);
		entryView.setUint16(36, 0, true);
		entryView.setUint32(38, 0, true);
		entryView.setUint32(42, offset, true);
		entry.set(name, 46);
		central.push(entry);
		offset += header.length + data.length;
	}
	const directory = central.reduce((size, entry) => size + entry.length, 0);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true);
	endView.setUint16(8, files.length, true);
	endView.setUint16(10, files.length, true);
	endView.setUint32(12, directory, true);
	endView.setUint32(16, offset, true);
	const parts = [...local, ...central, end];
	const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
	let at = 0;
	for (const part of parts) {
		bytes.set(part, at);
		at += part.length;
	}
	return bytes;
};
/** The report workbook: one sheet, the columns in the order the page shows them. */
export function xlsxWorkbook(
	name: string,
	columns: readonly XlsxColumn[],
	rows: readonly { readonly [field: string]: unknown }[]
) {
	const sheet = xml(name.slice(0, 31) || 'Report');
	return zipped([
		{
			name: '[Content_Types].xml',
			text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
		},
		{
			name: '_rels/.rels',
			text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
		},
		{
			name: 'xl/workbook.xml',
			text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheet}" sheetId="1" r:id="rId1"/></sheets></workbook>`
		},
		{
			name: 'xl/_rels/workbook.xml.rels',
			text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
		},
		{ name: 'xl/worksheets/sheet1.xml', text: sheetXml(columns, rows) }
	]);
}
