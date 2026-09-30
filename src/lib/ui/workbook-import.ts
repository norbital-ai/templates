import type { ActInput, ActOutput, Callable } from '@norbital-ai/bolt';
import { bolt } from '$bolt';
import { t } from './t.js';
import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { toast } from 'svelte-sonner';
import {
	csvGrid,
	workbookGrids,
	WorkbookImportError,
	type WorkbookGrids
} from '../workbook-rows.js';
import { getErrorMessage } from '../refuse.js';
import { formatNamedList } from '../period.js';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv';
const FAILURE_TOAST_MS = 20_000;

/** A file the operator picks, or null when they dismiss the dialog. */
function pickWorkbookFile(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = ACCEPTED_FILE_TYPES;
		input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
		// Dismissing the dialog fires `cancel`; without it a cancelled import would never settle.
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.click();
	});
}

async function readWorkbookGrids(file: File): Promise<WorkbookGrids> {
	if (file.name.toLowerCase().endsWith('.csv'))
		return new Map([[file.name, csvGrid(await file.text())]]);
	const workbook = new ExcelJSBrowser.Workbook();
	try {
		await workbook.xlsx.load(await file.arrayBuffer());
	} catch (cause) {
		throw new WorkbookImportError(t('component.workbook_not_spreadsheet', { file: file.name }), [
			t('component.workbook_save_as'),
			getErrorMessage(cause)
		]);
	}
	return workbookGrids(workbook);
}

/**
 * The spreadsheet import every page shares: the operator picks an XLSX or CSV, the page reads it into the action's
 * input in the browser, and one act writes it (or refuses it whole, naming the rows). Every problem is a toast whose
 * first line is the headline and the rest its detail. An `overwritten` option (the stored records the import changed
 * or removed, by name) has them listed under the success toast, so a re-import never reverts an in-app edit silently.
 */
export async function runWorkbookImport<const A extends string>(options: {
	/** The collection action that takes the payload (`jurisdiction_holidays.import_workbook`, `work_days.import_month`). */
	readonly action: A extends Callable ? A : Callable;
	readonly recordLabel: string;
	buildPayload(grids: WorkbookGrids): ActInput<A>;
	/** The rows a committed import wrote; a held one counts the records it holds. */
	importedCount?(payload: ActInput<A>, output: ActOutput<A>): number;
	/** The stored records a committed import changed or removed, by name. */
	overwritten?(output: ActOutput<A>): readonly string[];
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
		toast.success(
			t('component.workbook_imported', {
				count:
					(outcome.kind === 'committed'
						? options.importedCount?.(payload, outcome.output)
						: undefined) ?? outcome.records.length,
				label: options.recordLabel,
				file: file.name
			}),
			overwritten.length === 0
				? {}
				: {
						description: `${t('component.workbook_overwritten', { count: overwritten.length })}\n${formatNamedList(overwritten)}`,
						descriptionClass: 'whitespace-pre-line',
						duration: FAILURE_TOAST_MS
					}
		);
		options.afterImport?.(payload);
	} catch (error) {
		const message = getErrorMessage(error);
		const [headline = '', ...detail] = message.split('\n');
		const description = detail.join('\n').trim();
		toast.error(headline.trim() || t('component.workbook_import_failed', { file: file.name }), {
			...(description === '' ? {} : { description }),
			descriptionClass: 'whitespace-pre-line',
			duration: FAILURE_TOAST_MS
		});
	}
}
