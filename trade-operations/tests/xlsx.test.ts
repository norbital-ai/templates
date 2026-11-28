import { expect, it } from '@effect/vitest';
import { reportColumnsToXlsx, xlsxWorkbook } from '../src/lib/xlsx.js';

const decoder = new TextDecoder();

/** The written workbook uses stored entries, so the local headers carry each file's text directly. */
const files = (bytes: Uint8Array) => {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out = new Map<string, string>();
	let at = 0;
	while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
		const size = view.getUint32(at + 18, true);
		const nameLength = view.getUint16(at + 26, true);
		const name = decoder.decode(bytes.slice(at + 30, at + 30 + nameLength));
		const start = at + 30 + nameLength;
		out.set(name, decoder.decode(bytes.slice(start, start + size)));
		at = start + size;
	}
	return out;
};

it('writes an XLSX workbook with the displayed columns and numeric cells', () => {
	const bytes = xlsxWorkbook(
		'Sales analysis',
		[
			{ field: 'order_number', label: 'Order' },
			{ field: 'net', label: 'Net', numeric: true, scale: 2 }
		],
		[
			{ order_number: 'TR-2026-0001', net: '22.60' },
			{ order_number: 'TR-2026-0002', net: 10 }
		]
	);
	expect(bytes[0]).toBe(0x50);
	expect(bytes[1]).toBe(0x4b);
	const entries = files(bytes);
	expect([...entries.keys()]).toEqual([
		'[Content_Types].xml',
		'_rels/.rels',
		'xl/workbook.xml',
		'xl/_rels/workbook.xml.rels',
		'xl/worksheets/sheet1.xml'
	]);
	expect(entries.get('xl/workbook.xml')).toContain('name="Sales analysis"');
	const sheet = entries.get('xl/worksheets/sheet1.xml') ?? '';
	expect(sheet).toContain('>Order</t>');
	expect(sheet).toContain('>Net</t>');
	expect(sheet).toContain('TR-2026-0001');
	expect(sheet).toContain('<v>22.60</v>');
	expect(sheet).toContain('<v>10.00</v>');
});

it('auto-appends explicit currency columns, formats per-row currency scale, and preserves >15-digit BigDecimal precision', () => {
	const cols = reportColumnsToXlsx([
		{ field: 'order_number', label: 'Order' },
		{ field: 'net', label: 'Net', kind: { kind: 'money', currency: 'currency' } },
		{ field: 'cost', label: 'Cost', kind: { kind: 'money', currency: 'cost_currency' } }
	]);
	expect(cols.map((c) => c.field)).toEqual([
		'order_number',
		'net',
		'cost',
		'currency',
		'cost_currency'
	]);
	const bytes = xlsxWorkbook('Multi', cols, [
		{
			order_number: 'SO-JPY',
			net: '12500',
			cost: '9007199254740993.125',
			currency: 'JPY',
			cost_currency: 'CNY'
		},
		{
			order_number: 'SO-USD',
			net: '100.5',
			cost: '720',
			currency: 'USD',
			cost_currency: 'CNY'
		}
	]);
	const sheet = files(bytes).get('xl/worksheets/sheet1.xml') ?? '';
	expect(sheet).toContain('>Currency</t>');
	expect(sheet).toContain('>Cost currency</t>');
	expect(sheet).toContain('>JPY</t>');
	expect(sheet).toContain('>USD</t>');
	expect(sheet).toContain('<v>12500</v>');
	expect(sheet).toContain('<v>100.50</v>');
	expect(sheet).toContain('<v>9007199254740993.13</v>');
});
