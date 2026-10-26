import { Effect, Schema } from 'effect';
import type {
	ActInput,
	ActOutput,
	Callable,
	Committed,
	PendingApproval,
	Running
} from '@norbital-ai/bolt';
import type { ActFailure } from '@norbital-ai/bolt/errors';
import type { CellValue } from 'exceljs';
import type { Cell } from '@norbital-ai/std/sheet';
import { csvRows } from '@norbital-ai/std/csv';
import { bolt } from '$bolt';
import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { notifyOutcome, toast } from '@norbital-ai/ui';
import { getErrorMessage, formatNamedList } from '../../payroll_engine/foundation.js';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv';
const FAILURE_TOAST_MS = 20_000;
type SheetTable = readonly (readonly Cell[])[];
export type WorkbookGrids = ReadonlyMap<string, SheetTable>;
export class WorkbookImportError extends Schema.TaggedError<WorkbookImportError>()(
	'WorkbookImportError',
	{
		message: Schema.String,
		detail: Schema.Array(Schema.String)
	}
) {}

function cell(value: CellValue | undefined): Cell {
	if (value === undefined || value === null) return null;
	if (Schema.is(Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))(value)) return value;
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if ('result' in value) return cell(value.result);
	if ('richText' in value) return value.richText.map((part) => part.text).join('');
	if ('text' in value) return value.text;
	if ('error' in value) return value.error;
	return null;
}
function workbookGrids(workbook: InstanceType<typeof ExcelJSBrowser.Workbook>): WorkbookGrids {
	return new Map(
		workbook.worksheets.map((sheet) => {
			const rows: Cell[][] = [];
			sheet.eachRow({ includeEmpty: true }, (row) => {
				const values = Array.isArray(row.values) ? row.values : [];
				rows.push(values.slice(1).map(cell));
			});
			return [sheet.name, rows];
		})
	);
}

/** The picker belongs to its fiber; cancel and interruption both remove the input. */
const pickWorkbookFile = () =>
	Effect.callback<File | null>((resume) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = ACCEPTED_FILE_TYPES;
		input.hidden = true;
		const finish = (file: File | null) => {
			input.remove();
			resume(Effect.succeed(file));
		};
		input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
		input.addEventListener('cancel', () => finish(null), { once: true });
		document.body.append(input);
		input.click();
		return Effect.sync(() => input.remove());
	});

const readWorkbookGrids = Effect.fnUntraced(function* (file: File) {
	const invalidWorkbook = (cause: unknown) =>
		new WorkbookImportError({
			message: bolt.t('component.workbook_not_spreadsheet', { file: file.name }),
			detail: [bolt.t('component.workbook_save_as'), getErrorMessage(cause)]
		});
	if (file.name.toLowerCase().endsWith('.csv')) {
		const text = yield* Effect.tryPromise({ try: () => file.text(), catch: invalidWorkbook });
		return new Map([[file.name, csvRows(text)]]);
	}
	const workbook = new ExcelJSBrowser.Workbook();
	const bytes = yield* Effect.tryPromise({ try: () => file.arrayBuffer(), catch: invalidWorkbook });
	yield* Effect.tryPromise({ try: () => workbook.xlsx.load(bytes), catch: invalidWorkbook });
	return workbookGrids(workbook);
});

/** One picked workbook, one native act, and its complete result rendered as a toast. */
export const runWorkbookImport = Effect.fnUntraced(function* <const A extends string>(options: {
	readonly action: A extends Callable ? A : Callable;
	readonly recordLabel: string;
	buildPayload(grids: WorkbookGrids): ActInput<A>;
	importedCount?(payload: ActInput<A>, output: ActOutput<A>): number;
	overwritten?(output: ActOutput<A>): readonly string[];
	warnings?(output: ActOutput<A>): readonly string[];
	afterImport?(payload: ActInput<A>): void;
}) {
	const file = yield* pickWorkbookFile();
	if (file === null) return;
	const importing = Effect.gen<
		Effect.Effect<
			WorkbookGrids | ActInput<A> | Committed<ActOutput<A>, A> | PendingApproval<A> | Running,
			WorkbookImportError | ActFailure
		>,
		void
	>(function* () {
		const grids = yield* readWorkbookGrids(file);
		const payload = yield* Effect.try({
			try: () => options.buildPayload(grids),
			catch: (cause) =>
				cause instanceof WorkbookImportError
					? cause
					: new WorkbookImportError({
							message: getErrorMessage(cause),
							detail: []
						})
		});
		const outcome = yield* bolt.act<A>(options.action, payload);
		if (outcome.kind === 'pendingApproval') {
			toast.info(bolt.t('offboarding.pending'));
			return;
		}
		if (outcome.kind === 'running') {
			notifyOutcome(bolt, outcome);
			return;
		}
		const overwritten = options.overwritten?.(outcome.output) ?? [];
		toast.success(
			bolt.t('component.workbook_imported', {
				count: options.importedCount?.(payload, outcome.output) ?? outcome.records.length,
				label: options.recordLabel,
				file: file.name
			}),
			overwritten.length === 0
				? {}
				: {
						description: `${bolt.t('component.workbook_overwritten', { count: overwritten.length })}\n${formatNamedList(overwritten)}`,
						duration: FAILURE_TOAST_MS
					}
		);
		const warnings = options.warnings?.(outcome.output) ?? [];
		if (warnings.length > 0)
			toast.warning(bolt.t('component.workbook_warnings', { count: warnings.length }), {
				description: warnings.join('\n'),
				duration: FAILURE_TOAST_MS
			});
		options.afterImport?.(payload);
	});
	yield* importing.pipe(
		Effect.catch((error) =>
			Effect.sync(() => {
				const message = getErrorMessage(error);
				const [headline = '', ...lines] = message.split('\n');
				const detail = error instanceof WorkbookImportError ? [...lines, ...error.detail] : lines;
				const description = detail.join('\n').trim();
				toast.error(
					headline.trim() || bolt.t('component.workbook_import_failed', { file: file.name }),
					{
						...(description === '' ? {} : { description }),
						duration: FAILURE_TOAST_MS
					}
				);
			})
		)
	);
});
