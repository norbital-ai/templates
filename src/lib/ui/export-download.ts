/**
 * The browser half of a collection export: the manifest the server answers with, as files on disk.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE FILE IS WRITTEN HERE AND NOT BY THE PLATFORM.
 *
 * `collections.export` answers with a manifest and nothing else — a list of actions, each naming
 * its attachments and carrying their content as JSON. The platform never writes a file, for the
 * same reason it never parses one on the way in: an export pipeline is authored per workspace, so
 * the *shape* of an attachment's content is the workspace's own. A workbook is a byte array, a bank
 * file is rows, a payslip is a PDF document; only the side that produced those shapes can turn them
 * back into a file, and that is this side.
 *
 * `contentType` on the attachment is therefore the contract between the two halves —
 * `payroll_runs/+pipelines.ts` states `XLSX`, `CSV` or `PDF`, and this reads it — rather than a
 * decoration nobody consumes. Without this module the three artefacts a settled run produces are
 * built, serialised, posted, decoded and then dropped on the floor.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

import type { downloadCollectionExport } from '@norbital-ai/bolt/client';

/**
 * The manifest as the client hands it over.
 *
 * Taken from the function's own return type rather than restated: `@norbital-ai/bolt/client`
 * re-exports the two commands but not the types around them, and a hand-written copy of a shape the
 * platform decodes is a second shape to keep in step with the first.
 */
type CollectionExportManifest = Awaited<ReturnType<typeof downloadCollectionExport>>;
type ExportAttachment = CollectionExportManifest[number]['attachments'][number];

const MEDIA_TYPES: Readonly<Record<string, string>> = {
	CSV: 'text/csv;charset=utf-8',
	HTML: 'text/html;charset=utf-8',
	JSON: 'application/json;charset=utf-8',
	PDF: 'application/pdf',
	TEXT: 'text/plain;charset=utf-8',
	XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
const BINARY_MEDIA_TYPE = 'application/octet-stream';

/**
 * An object URL outlives the click that used it, because revoking it in the same tick can cancel a
 * download the browser has not begun reading yet. A minute is far longer than any browser takes and
 * far shorter than a session.
 */
const OBJECT_URL_LIFETIME_MS = 60_000;

/** One CSV field, quoted only when it has to be, so a comma or a newline stays inside its cell. */
function csvCell(value: unknown): string {
	if (value == null) return '';
	const text = String(value);
	return /["\r\n,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 line endings, which is what every spreadsheet reads a CSV as. */
function csvText(rows: readonly (readonly unknown[])[]): string {
	return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** A byte array as JSON carries one: `payrollReportXlsx` answers with `[...new Uint8Array(…)]`. */
function byteArray(content: unknown): Uint8Array<ArrayBuffer> | null {
	if (!Array.isArray(content) || content.length === 0) return null;
	return content.every((byte) => typeof byte === 'number') ? Uint8Array.from(content) : null;
}

/** A grid of rows, which is how a CSV attachment states itself. */
function rowGrid(content: unknown): readonly (readonly unknown[])[] | null {
	return Array.isArray(content) && content.every((row) => Array.isArray(row))
		? (content as readonly (readonly unknown[])[])
		: null;
}

/**
 * One code unit, one byte.
 *
 * A PDF is a byte-counted format: `textPdf` writes `/Length` and the cross-reference table from
 * JavaScript string offsets, so the file is only valid if each of those characters becomes exactly
 * one byte. Its content is ASCII by construction — `pdfText` replaces everything outside
 * `\x20-\x7e` — and encoding it as UTF-8 would still be byte-identical today, but the offsets are
 * what the reader trusts, so they are written as the bytes they were counted as.
 */
function singleByteEncoding(text: string): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(text.length);
	for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
	return bytes;
}

/** The attachment as the bytes its `contentType` says it is. */
function attachmentBlob(attachment: ExportAttachment): Blob {
	const mediaType = MEDIA_TYPES[attachment.contentType] ?? BINARY_MEDIA_TYPE;
	const bytes = byteArray(attachment.content);
	if (bytes != null) return new Blob([bytes], { type: mediaType });
	const rows = rowGrid(attachment.content);
	if (rows != null) return new Blob([csvText(rows)], { type: mediaType });
	if (typeof attachment.content === 'string') {
		return new Blob(
			[
				attachment.contentType === 'PDF'
					? singleByteEncoding(attachment.content)
					: attachment.content
			],
			{ type: mediaType }
		);
	}
	// An attachment shape this workspace does not produce still reaches the operator as something
	// they can open, rather than as a silently missing file.
	return new Blob([JSON.stringify(attachment.content, null, '\t')], { type: MEDIA_TYPES.JSON });
}

/**
 * Hands one blob to the browser under the name the pipeline gave it.
 *
 * The anchor is never attached to the page, for the same reason the import's file input is not: a
 * control left in the layout is one more thing an unmounted view can leave behind, and this one
 * lives exactly as long as the click.
 */
function saveBlob(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = name;
	anchor.rel = 'noopener';
	anchor.click();
	// repository-health:allow A1 -- This detached timer owns deferred URL revocation; cancelling it on return would leak the URL.
	setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
}

/**
 * Saves every attachment of every action in the manifest, and answers how many files that was.
 *
 * One action can carry many attachments — a period's payslips are one action and one PDF per
 * employee — so a browser asked for more than one file will ask the operator once whether to allow
 * it. Nothing is bundled here: the manifest names the files, and the names it gives them are what
 * lands on disk.
 */
export function saveCollectionExport(manifest: CollectionExportManifest): number {
	let saved = 0;
	for (const action of manifest) {
		for (const attachment of action.attachments) {
			saveBlob(attachmentBlob(attachment), attachment.name);
			saved += 1;
		}
	}
	return saved;
}
