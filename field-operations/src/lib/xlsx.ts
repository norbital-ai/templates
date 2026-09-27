import { gridRecords } from './csv.js';

/**
 * The first worksheet of an xlsx workbook as records keyed by its header row, blank cells omitted —
 * the same shape `csvRecords` gives, so a sheet saved from Excel imports as its CSV would.
 *
 * An xlsx is a zip of XML parts; the browser's own `DecompressionStream` inflates them. Cells come
 * back as Excel stores them: a typed date is its day serial, which the import pipeline reads.
 */
export async function xlsxRecords(bytes: ArrayBuffer): Promise<Array<Record<string, string>>> {
	const parts = zipEntries(new Uint8Array(bytes));
	const read = async (name: string) => {
		const part = parts.get(name);
		return part === undefined ? '' : new TextDecoder().decode(await part());
	};
	const firstSheetId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(await read('xl/workbook.xml'))?.[1];
	const target = [...(await read('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)]
		.map(([tag]) => tag)
		.find((tag) => attribute(tag, 'Id') === firstSheetId);
	const path = attribute(target ?? '', 'Target')?.replace(/^\/?(xl\/)?/, 'xl/');
	if (path === undefined) throw new Error('This workbook has no worksheet.');
	const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
		([, item]) => texts(item!)
	);

	const grid: string[][] = [];
	for (const [, cells] of (await read(path)).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
		const row: string[] = [];
		for (const [tag, , body = ''] of cells!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
			const column = columnIndex(attribute(tag, 'r') ?? '') ?? row.length;
			const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
			const type = attribute(tag, 't');
			row[column] =
				type === 's'
					? (shared[Number.parseInt(value ?? '', 10)] ?? '')
					: type === 'inlineStr'
						? texts(body)
						: unescapeXml(value ?? '');
		}
		grid.push(Array.from(row, (cell) => cell ?? ''));
	}
	return gridRecords(grid.filter((row) => row.some((cell) => cell.trim() !== '')));
}

function attribute(tag: string, name: string): string | undefined {
	const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
	return value === undefined ? undefined : unescapeXml(value);
}

/** A cell's text: every run's `<t>`, phonetic guides (`<rPh>`) left out. */
const texts = (xml: string) =>
	[...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
		.map(([, text]) => unescapeXml(text!))
		.join('');

const unescapeXml = (text: string) =>
	text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, entity: string) =>
		entity[0] === '#'
			? String.fromCodePoint(
					entity[1] === 'x'
						? Number.parseInt(entity.slice(2), 16)
						: Number.parseInt(entity.slice(1), 10)
				)
			: ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[entity]!
	);

/** `C7` → 2. */
function columnIndex(reference: string): number | undefined {
	const letters = /^[A-Z]+/.exec(reference)?.[0];
	if (letters === undefined) return undefined;
	return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

/** Each stored or deflated entry of a zip, by name, read through its central directory. */
function zipEntries(zip: Uint8Array<ArrayBuffer>): Map<string, () => Promise<Uint8Array>> {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	let end = zip.length - 22;
	while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
	if (end < 0) throw new Error('This file is not an xlsx workbook.');
	const entries = new Map<string, () => Promise<Uint8Array>>();
	let at = view.getUint32(end + 16, true);
	for (let count = view.getUint16(end + 10, true); count > 0; count -= 1) {
		const method = view.getUint16(at + 10, true);
		const size = view.getUint32(at + 20, true);
		const nameLength = view.getUint16(at + 28, true);
		const local = view.getUint32(at + 42, true);
		const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
		const data = zip.subarray(start, start + size);
		entries.set(name, async () =>
			method === 0
				? data
				: new Uint8Array(
						await new Response(
							new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
						).arrayBuffer()
					)
		);
	}
	return entries;
}
