/**
 * The browser half of a collection import: choose a file, read it, post the JSON, report the answer.
 *
 * It hangs off the same collection actions menu as the exports — `importPipelines` on
 * `CollectionTable`, beside `exportPipelines` — so the operator sends a file back through the
 * button they downloaded one from.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE FILE IS PARSED HERE AND NOT ON THE SERVER.
 *
 * `import_data` is arbitrary structured JSON: the platform hands the pipeline whatever the caller
 * posted, and never opens a spreadsheet. So the workbook is read in the browser and the pipeline is
 * given rows. That split is also why the pipeline stays the only place that resolves anything —
 * employee numbers, shift codes, holidays and timezones are the server's, checked against the
 * company the records belong to, not against whatever this browser happens to have loaded.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { importCollectionRecords } from '@norbital-ai/bolt/client';
import { toast } from 'svelte-sonner';
import type { Translator } from './roster/roster-month.js';
import {
	csvGrid,
	workbookGrids,
	WorkbookImportError,
	type WorkbookGrids
} from '../workbook-rows.js';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv';
const FAILURE_TOAST_MS = 20_000;

/**
 * Opens the operator's file picker and resolves with their choice, or nothing if they cancelled.
 *
 * The input is never attached to the page. A hidden control in the layout would be one more thing
 * that can be left behind by an unmounted table; this one lives exactly as long as the question.
 */
export async function pickWorkbookFile(t: Translator): Promise<File | null> {
	if (typeof document === 'undefined') {
		throw new Error(t('component.workbook_browser_only'));
	}
	return new Promise<File | null>((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = ACCEPTED_FILE_TYPES;
		let settled = false;
		const finish = (file: File | null): void => {
			if (settled) return;
			settled = true;
			resolve(file);
		};
		input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
		// Dismissing the dialog fires `cancel`; without it a cancelled run would hang on this promise
		// and leave the pipeline's button spinning until the page was reloaded.
		input.addEventListener('cancel', () => finish(null), { once: true });
		input.click();
	});
}

/**
 * Every sheet in the chosen file, as grids of plain values.
 *
 * ExcelJS's browser distribution is the one the payroll workbook is already written with, so
 * reading costs no new dependency. A CSV has one sheet and no name of its own, so it takes the
 * file's — `requireSheet` accepts a single-sheet file under any name.
 */
export async function readWorkbookGrids(file: File, t: Translator): Promise<WorkbookGrids> {
	if (file.name.toLowerCase().endsWith('.csv')) {
		return new Map([[file.name, csvGrid(await file.text())]]);
	}
	const workbook = new ExcelJSBrowser.Workbook();
	try {
		await workbook.xlsx.load(await file.arrayBuffer());
	} catch (cause) {
		throw new WorkbookImportError(t('component.workbook_not_spreadsheet', { file: file.name }), [
			t('component.workbook_save_as'),
			cause instanceof Error ? cause.message : String(cause)
		]);
	}
	return workbookGrids(workbook);
}

/**
 * Shows a refusal as its headline and the rows it names.
 *
 * Both halves of the import refuse the same way: the reader lists the cells it could not read, and
 * the pipeline lists the rows the company's own records contradict. Either arrives as a headline
 * followed by a bulleted list, so the first line becomes the toast and the rest its detail rather
 * than one unreadable run of text.
 */
function reportImportFailure(fallbackHeadline: string, error: unknown, t: Translator): void {
	const message = error instanceof Error ? error.message : String(error);
	const [headline = '', ...detail] = message.split('\n');
	toast.error(headline.trim() === '' ? fallbackHeadline : headline.trim(), {
		description: detail.join('\n').trim() || undefined,
		descriptionClass: 'whitespace-pre-line',
		duration: FAILURE_TOAST_MS
	});
}

export interface WorkbookImportOptions {
	readonly collectionName: string;
	/** Names the thing being imported in the toasts: "roster rows", "time entries". */
	readonly recordLabel: string;
	/**
	 * Turns the chosen file into the JSON this collection's import pipeline declares.
	 *
	 * `object` rather than `Record<string, unknown>`: the payload builders return declared interfaces
	 * (`RosterImportPayload`, `TimeEntryImportPayload`), and an interface has no implicit index
	 * signature, so naming the record type here would reject the very functions this exists for. The
	 * widening to a record happens once, below, where the payload becomes a wire value.
	 */
	buildPayload(grids: WorkbookGrids): object;
}

/**
 * Runs one import end to end and reports it.
 *
 * Failures are shown here rather than rethrown. `CollectionTable` catches what a pipeline throws
 * and toasts `error.message`, which for these refusals is a headline and a bulleted list of rows
 * collapsed into a single line — so this handles its own and hands the caller a quiet return.
 */
export async function runWorkbookImport(
	options: WorkbookImportOptions,
	t: Translator
): Promise<void> {
	const file = await pickWorkbookFile(t);
	if (file == null) return;
	try {
		const payload = { ...options.buildPayload(await readWorkbookGrids(file, t)) };
		/**
		 * The whole file is one record, not one record per row.
		 *
		 * `collections.import` declares `{ records: [{ collection, id, values }] }`, and `values` is
		 * the document the collection's import pipeline declares as its `input` — header fields and
		 * rows together. Splitting the file across `records` would leave the header fields the
		 * pipeline validates against (`roster_id`, `month`, `legal_entity`, `timezone`) with nowhere
		 * to go, and each fragment would be checked against the company's records on its own.
		 *
		 * The id is minted here because the command requires one, not because it is used: a
		 * pipeline-backed collection gets the ids of its writes from the rows the pipeline returns,
		 * and this one is never stored.
		 */
		const imported = await importCollectionRecords({
			records: [{ collection: options.collectionName, id: crypto.randomUUID(), values: payload }]
		});
		toast.success(
			t('component.workbook_imported', {
				// The pipeline's own row count. One posted file becomes as many records as the pipeline
				// makes of it — a month grid is one document and a few hundred rows — so the number of
				// things posted says nothing about the number of things imported.
				count: imported,
				label: options.recordLabel,
				file: file.name
			})
		);
	} catch (error) {
		reportImportFailure(t('component.workbook_import_failed', { file: file.name }), error, t);
	}
}
