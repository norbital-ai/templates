import { Effect, Schema } from 'effect';
import type { ActInput, ActOutput, Callable } from '@norbital-ai/bolt';
import type { ActFailure, ProtocolFailed } from '@norbital-ai/bolt/errors';
import type { CellValue } from 'exceljs';
import Papa from 'papaparse';
import type { PageContext } from '@norbital-ai/bolt/page';
import ExcelJSBrowser from 'exceljs/dist/exceljs.bare.min.js';
import { notify_outcome, toast } from '@norbital-ai/ui';
import { getErrorMessage, formatNamedList } from '../../payroll_engine/foundation.js';
import { WorkbookRowsError, type Cell } from '../../payroll_engine/workbook_rows.js';

const ACCEPTED_FILE_TYPES = '.xlsx,.csv';
const FAILURE_TOAST_MS = 20_000;
type SheetTable = readonly (readonly Cell[])[];
type Ctx = Pick<PageContext, 't' | 'act'>;
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
	if (value instanceof Date) {
		const iso = value.toISOString();
		// Excel's time-only cell is a time on its epoch day; a midnight is a date, anything else a date and time
		if (iso < '1900-01-01') return iso.slice(11, 16);
		return iso.endsWith('T00:00:00.000Z')
			? iso.slice(0, 10)
			: `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
	}
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

const readWorkbookGrids = Effect.fnUntraced(function* (ctx: Pick<Ctx, 't'>, file: File) {
	const invalidWorkbook = (cause: unknown) =>
		new WorkbookImportError({
			message: ctx.t('component.workbook_not_spreadsheet', { file: file.name }),
			detail: [ctx.t('component.workbook_save_as'), getErrorMessage(cause)]
		});
	if (file.name.toLowerCase().endsWith('.csv')) {
		const text = yield* Effect.tryPromise({ try: () => file.text(), catch: invalidWorkbook });
		// RFC 4180 rows; a trailing newline adds no row
		const rows = Papa.parse<string[]>(text.replace(/(\r\n|\n|\r)$/, ''), { delimiter: ',' }).data;
		return new Map([[file.name, rows]]);
	}
	const workbook = new ExcelJSBrowser.Workbook();
	const bytes = yield* Effect.tryPromise({ try: () => file.arrayBuffer(), catch: invalidWorkbook });
	yield* Effect.tryPromise({ try: () => workbook.xlsx.load(bytes), catch: invalidWorkbook });
	return workbookGrids(workbook);
});

/** A parsed sheet's problem, as the toast's headline and detail. */
export const workbookImportError = (cause: unknown): WorkbookImportError => {
	if (cause instanceof WorkbookImportError) return cause;
	if (cause instanceof WorkbookRowsError)
		return new WorkbookImportError({ message: cause.message, detail: [...cause.detail] });
	return new WorkbookImportError({ message: getErrorMessage(cause), detail: [] });
};

export type WorkbookImportSummary = {
	readonly imported: number;
	readonly overwritten?: readonly string[];
	readonly warnings?: readonly string[];
};
type StepSummary = WorkbookImportSummary | { readonly skipped: true };

/** One picked workbook and its report; the caller owns the writes. */
const runSelectedWorkbook = Effect.fnUntraced(function* <P>(
	ctx: Pick<Ctx, 't'>,
	options: {
		readonly recordLabel: string;
		buildPayload(grids: WorkbookGrids): Effect.Effect<P, WorkbookImportError>;
		submit(
			payload: P
		): Effect.Effect<StepSummary, WorkbookImportError | ActFailure | ProtocolFailed>;
		afterImport?(payload: P): void;
	}
) {
	const file = yield* pickWorkbookFile();
	if (file === null) return;
	const importing = Effect.gen(function* () {
		const grids = yield* readWorkbookGrids(ctx, file);
		const payload = yield* options.buildPayload(grids);
		const report = yield* options.submit(payload);
		if ('skipped' in report) return;
		const overwritten = report.overwritten ?? [];
		toast.success(
			ctx.t('component.workbook_imported', {
				count: report.imported,
				label: options.recordLabel,
				file: file.name
			}),
			overwritten.length === 0
				? {}
				: {
						description: `${ctx.t('component.workbook_overwritten', { count: overwritten.length })}\n${formatNamedList(overwritten)}`,
						duration: FAILURE_TOAST_MS
					}
		);
		const warnings = report.warnings ?? [];
		if (warnings.length > 0)
			toast.warning(ctx.t('component.workbook_warnings', { count: warnings.length }), {
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
					headline.trim() || ctx.t('component.workbook_import_failed', { file: file.name }),
					{
						...(description === '' ? {} : { description }),
						duration: FAILURE_TOAST_MS
					}
				);
			})
		)
	);
});

/** One callable's act map. */
export const only = <const A extends string, V>(action: A, input: V) =>
	({ [action]: input }) as { readonly [K in A]: V };

/** One picked workbook, one native act, and its complete result rendered as a toast. */
export const runWorkbookImport = Effect.fnUntraced(function* <const A extends string>(
	ctx: Ctx,
	options: {
		readonly action: A extends Callable ? A : Callable;
		readonly recordLabel: string;
		buildPayload(grids: WorkbookGrids): ActInput<A>;
		importedCount?(payload: ActInput<A>, output: ActOutput<A>): number;
		overwritten?(output: ActOutput<A>): readonly string[];
		warnings?(output: ActOutput<A>): readonly string[];
		afterImport?(payload: ActInput<A>): void;
	}
) {
	yield* runSelectedWorkbook<ActInput<A>>(ctx, {
		recordLabel: options.recordLabel,
		buildPayload: (grids) =>
			Effect.try({
				try: () => options.buildPayload(grids),
				catch: workbookImportError
			}),
		submit: (payload) =>
			Effect.gen(function* () {
				const outcome = yield* ctx.act(only(options.action, payload));
				if (outcome.kind === 'pending_approval') {
					toast.info(ctx.t('offboarding.pending'));
					return { skipped: true } as const;
				}
				if (outcome.kind === 'running') {
					notify_outcome(ctx, outcome);
					return { skipped: true } as const;
				}
				return {
					imported:
						options.importedCount?.(payload, outcome.output[options.action]) ??
						outcome.records.length,
					overwritten: options.overwritten?.(outcome.output[options.action]) ?? [],
					warnings: options.warnings?.(outcome.output[options.action]) ?? []
				};
			}),
		...(options.afterImport == null ? {} : { afterImport: options.afterImport })
	});
});

/** The same picker and toasts for an import that writes through more than one callable. */
export const runWorkbookImportSteps = Effect.fnUntraced(function* <P>(
	ctx: Pick<Ctx, 't'>,
	options: {
		readonly recordLabel: string;
		buildPayload(grids: WorkbookGrids): Effect.Effect<P, WorkbookImportError>;
		submit(
			payload: P
		): Effect.Effect<WorkbookImportSummary, WorkbookImportError | ActFailure | ProtocolFailed>;
		afterImport?(payload: P): void;
	}
) {
	yield* runSelectedWorkbook(ctx, options);
});
