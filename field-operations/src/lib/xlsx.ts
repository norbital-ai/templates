import { Effect, Schema } from 'effect';
import { FlateErrorCode, unzip, type Unzipped } from 'fflate';
import { gridRecords } from './csv.js';
class WorkbookInvalid extends Schema.TaggedError<WorkbookInvalid>()('WorkbookInvalid', {
	message: Schema.String
}) {}
/**
 * The first worksheet of an xlsx workbook as records keyed by its header row, blank cells omitted —
 * the same shape `csvRecords` gives, so a sheet saved from Excel imports as its CSV would.
 *
 * An xlsx is a zip of XML parts; the shared codec extracts only requested parts, using its worker for large entries. Cells come
 * back as Excel stores them: a typed date is its day serial, which the import pipeline reads.
 */
export const xlsxRecords = Effect.fnUntraced(function* (bytes: ArrayBuffer) {
	const read = (name: string) =>
		Effect.callback<Unzipped, WorkbookInvalid>((resume) => {
			const terminate = unzip(
				new Uint8Array(bytes),
				{ filter: (entry) => entry.name === name },
				(error, parts) =>
					resume(
						error
							? Effect.fail(
									new WorkbookInvalid({
										message:
											error.code === FlateErrorCode.InvalidZipData
												? 'This file is not an xlsx workbook.'
												: error.message
									})
								)
							: Effect.succeed(parts)
					)
			);
			return Effect.sync(terminate);
		}).pipe(
			Effect.map((parts) => {
				const part = parts[name];
				return part === undefined ? '' : new TextDecoder().decode(part);
			})
		);
	const firstSheetId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(yield* read('xl/workbook.xml'))?.[1];
	const target = [...(yield* read('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)]
		.map(([tag]) => tag)
		.find((tag) => attribute(tag, 'Id') === firstSheetId);
	const path = attribute(target ?? '', 'Target')?.replace(/^\/?(xl\/)?/, 'xl/');
	if (path === undefined)
		return yield* new WorkbookInvalid({ message: 'This workbook has no worksheet.' });
	const shared = [...(yield* read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
		([, item]) => texts(item ?? '')
	);
	const grid: string[][] = [];
	for (const [, cells] of (yield* read(path)).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
		const row: string[] = [];
		for (const [tag, , body = ''] of (cells ?? '').matchAll(
			/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
		)) {
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
});
function attribute(tag: string, name: string): string | undefined {
	const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
	return value === undefined ? undefined : unescapeXml(value);
}
/** A cell's text: every run's `<t>`, phonetic guides (`<rPh>`) left out. */
const texts = (xml: string) =>
	[...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
		.map(([, text]) => unescapeXml(text ?? ''))
		.join('');
const XML_ENTITIES: Record<string, string> = {
	lt: '<',
	gt: '>',
	amp: '&',
	quot: '"',
	apos: "'"
};
const unescapeXml = (text: string) =>
	text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, entity: string) =>
		entity[0] === '#'
			? String.fromCodePoint(
					entity[1] === 'x'
						? Number.parseInt(entity.slice(2), 16)
						: Number.parseInt(entity.slice(1), 10)
				)
			: (XML_ENTITIES[entity] ?? entity)
	);
/** `C7` → 2. */
function columnIndex(reference: string): number | undefined {
	const letters = /^[A-Z]+/.exec(reference)?.[0];
	if (letters === undefined) return undefined;
	return [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}
