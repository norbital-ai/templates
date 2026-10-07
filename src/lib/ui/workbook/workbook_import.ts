import type { ActInput, ActOutput, Callable } from '@norbital-ai/bolt';
import { bolt } from '$bolt';
import type { CellValue } from 'exceljs';
import { t } from '../i18n/t.js';
import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { toast } from 'svelte-sonner';
import { getErrorMessage } from '../../payroll_engine/foundation.js';
import { formatNamedList } from '../../payroll_engine/foundation.js';
import WorkbookImportDetails from './workbook_import_details.svelte';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv';
const FAILURE_TOAST_MS = 20_000;

/** One cell as a spreadsheet reader hands it over; a formula or rich text cell arrives as its value. */
export type SheetCell = CellValue;
/** One sheet's rows. */
export type SheetTable = readonly (readonly SheetCell[])[];
/** Every sheet of a picked file, keyed by sheet name. */
export type WorkbookGrids = ReadonlyMap<string, SheetTable>;

/** A workbook the reader refuses whole: the headline as `message`, the lines below it in `detail`. */
export class WorkbookImportError extends Error {
	readonly detail: readonly string[];

	constructor(message: string, detail: readonly string[] = []) {
		super(message);
		this.name = 'WorkbookImportError';
		this.detail = detail;
	}
}

/** RFC 4180 enough for the templates: quoted cells, doubled quotes, CRLF or LF rows. */
function csv_grid(text: string): SheetTable {
	const rows: SheetCell[][] = [];
	let row: SheetCell[] = [];
	let cell = '';
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const character = text[index]!;
		if (quoted) {
			if (character === '"') {
				if (text[index + 1] === '"') {
					cell += '"';
					index++;
				} else quoted = false;
			} else cell += character;
		} else if (character === '"') quoted = true;
		else if (character === ',') {
			row.push(cell);
			cell = '';
		} else if (character === '\n' || character === '\r') {
			if (character === '\r' && text[index + 1] === '\n') index++;
			row.push(cell);
			cell = '';
			rows.push(row);
			row = [];
		} else cell += character;
	}
	if (cell !== '' || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

function workbook_grids(workbook: InstanceType<typeof ExcelJSBrowser.Workbook>): WorkbookGrids {
	const grids = new Map<string, SheetTable>();
	for (const sheet of workbook.worksheets) {
		const rows: SheetCell[][] = [];
		sheet.eachRow({ includeEmpty: true }, (row) => {
			const values = Array.isArray(row.values) ? row.values : [];
			rows.push(values.slice(1));
		});
		grids.set(sheet.name, rows);
	}
	return grids;
}

/** A file the operator picks, or null when they dismiss the dialog. */
export function pickWorkbookFile(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = ACCEPTED_FILE_TYPES;
		input.hidden = true;
		const finish = (file: File | null) => {
			input.remove();
			resolve(file);
		};
		input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
		// Dismissing the dialog fires `cancel`; without it a cancelled import would never settle.
		input.addEventListener('cancel', () => finish(null), { once: true });
		document.body.append(input);
		input.click();
	});
}

export async function readWorkbookGrids(file: File): Promise<WorkbookGrids> {
	if (file.name.toLowerCase().endsWith('.csv'))
		return new Map([[file.name, csv_grid(await file.text())]]);
	const workbook = new ExcelJSBrowser.Workbook();
	try {
		await workbook.xlsx.load(await file.arrayBuffer());
	} catch (cause) {
		throw new WorkbookImportError(t('component.workbook_not_spreadsheet', { file: file.name }), [
			t('component.workbook_save_as'),
			getErrorMessage(cause)
		]);
	}
	return workbook_grids(workbook);
}

/**
 * The spreadsheet import every page shares: the operator picks an XLSX or CSV, the page reads it into the action's
 * input in the browser, and one act writes it (or refuses it whole, naming the rows). Every problem is a toast whose
 * first line is the headline and the rest its detail. An `overwritten` option (the stored records the import changed
 * or removed, by name) has them listed under the success toast, so a re-import never reverts an in-app edit silently.
 */
export async function runWorkbookImport<const A extends string>(options: {
	/** The collection action that takes the payload (`holiday.import_workbook`, `roster_entry.import_month`). */
	readonly action: A extends Callable ? A : Callable;
	readonly recordLabel: string;
	buildPayload(grids: WorkbookGrids): ActInput<A>;
	/** The rows a committed import wrote; a held one counts the records it holds. */
	importedCount?(payload: ActInput<A>, output: ActOutput<A>): number;
	/** The stored records a committed import changed or removed, by name. */
	overwritten?(output: ActOutput<A>): readonly string[];
	/** Non-blocking findings of a committed import (a statutory limit passed, a blank day), one line each. */
	warnings?(output: ActOutput<A>): readonly string[];
	afterImport?(payload: ActInput<A>): void;
}): Promise<void> {
	const file = await pickWorkbookFile();
	if (file == null) return;
	try {
		const payload = options.buildPayload(await readWorkbookGrids(file));
		// repository-health:allow CLONE -- the JSON round trip turns the sheet's `Date` cells into the text the action decodes
		// repository-health:allow R6b -- the text was produced from `payload` on the line itself
		const outcome = await bolt.act<A>(options.action, JSON.parse(JSON.stringify(payload)));
		if (outcome.kind === 'refused') throw new Error(outcome.message);
		if (outcome.kind !== 'committed' && outcome.kind !== 'pendingApproval')
			throw new Error(t('component.workbook_import_failed', { file: file.name }));
		const overwritten =
			outcome.kind === 'committed' ? (options.overwritten?.(outcome.output) ?? []) : [];
		toast.success<typeof WorkbookImportDetails>(
			t('component.workbook_imported', {
				count:
					(outcome.kind === 'committed'
						? options.importedCount?.(payload, outcome.output)
						: undefined) ?? outcome.records.length,
				label: options.recordLabel,
				file: file.name
			}),
			overwritten.length === 0
				? { closeButton: true }
				: {
						closeButton: true,
						description: WorkbookImportDetails,
						componentProps: {
							label: options.recordLabel,
							details: `${t('component.workbook_overwritten', { count: overwritten.length })}\n${formatNamedList(overwritten)}`
						},
						duration: FAILURE_TOAST_MS
					}
		);
		const warnings = outcome.kind === 'committed' ? (options.warnings?.(outcome.output) ?? []) : [];
		if (warnings.length > 0)
			toast.warning<typeof WorkbookImportDetails>(
				t('component.workbook_warnings', { count: warnings.length }),
				{
					closeButton: true,
					description: WorkbookImportDetails,
					componentProps: { label: options.recordLabel, details: warnings.join('\n') },
					duration: Number.POSITIVE_INFINITY
				}
			);
		options.afterImport?.(payload);
	} catch (error) {
		const message = getErrorMessage(error);
		const [headline = '', ...detail] = message.split('\n');
		const description = detail.join('\n').trim();
		toast.error<typeof WorkbookImportDetails>(
			headline.trim() || t('component.workbook_import_failed', { file: file.name }),
			{
				closeButton: true,
				...(description === ''
					? {}
					: {
							description: WorkbookImportDetails,
							componentProps: { label: options.recordLabel, details: description }
						}),
				duration: FAILURE_TOAST_MS
			}
		);
	}
}
