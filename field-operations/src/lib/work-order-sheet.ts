import { DateTime, Effect, Schema, SchemaIssue } from 'effect';
import { input_schema, type Json } from '@norbital-ai/bolt';

const text = Schema.optionalKey(Schema.String);
const decimal = Schema.optionalKey(Schema.FiniteFromString);
/** A real calendar day as `YYYY-MM-DD`. */
const day = Schema.String.check(
	Schema.makeFilter(
		(value: string) => Schema.is(input_schema({ kind: 'date' }))(value) || 'Not a calendar day'
	)
);
const WORK_ORDER_ROW = Schema.Struct({
	site: Schema.String,
	postal_code: text,
	unit_number: text,
	latitude: decimal,
	longitude: decimal,
	scheduled_for: day,
	title: Schema.String,
	nature: text,
	description: text,
	assignee_contact: text,
	external_ref: text
});
/** One decoded sheet row. */
export type WorkOrder = typeof WORK_ORDER_ROW.Type;
const REQUIRED = ['site', 'scheduled_for', 'title'];
/** `ctx.convert.ingest`'s answer for a spreadsheet or CSV: its sheets' header row and cells. */
export const IngestSheets = Schema.Struct({
	sheets: Schema.Array(
		Schema.Struct({
			columns: Schema.Array(Schema.String),
			rows: Schema.Array(Schema.Array(Schema.Json))
		})
	)
});
/** A sheet's rows as records keyed by the lower-cased header, blank cells omitted. */
export const sheetRecords = (sheet: (typeof IngestSheets.Type)['sheets'][number]) => {
	const names = sheet.columns.map((name) => name.trim().toLowerCase());
	return sheet.rows.flatMap((cells: readonly Json[]) => {
		const record = Object.fromEntries(
			names.flatMap((name, column) => {
				const value = cells[column] == null ? '' : String(cells[column]).trim();
				return name === '' || value === '' ? [] : [[name, value]];
			})
		);
		return Object.keys(record).length === 0 ? [] : [record];
	});
};
/** The calendar day an xlsx stores as its day serial (days since 1899-12-30). */
const serialDay = (serial: string) =>
	DateTime.formatIsoDateUtc(
		DateTime.add(DateTime.makeUnsafe('1899-12-30'), { days: Number.parseInt(serial, 10) })
	);
const issues = SchemaIssue.makeFormatterStandardSchemaV1();
export class SheetInvalid extends Schema.TaggedError<SheetInvalid>()('SheetInvalid', {
	message: Schema.String
}) {}
/** Decode the complete sheet once, before the first write. */
export const decodeWorkOrders = Effect.fnUntraced(function* (
	records: readonly Record<string, string>[]
) {
	const headers = new Set(records.flatMap((row) => Object.keys(row)));
	const missing = REQUIRED.filter((column) => !headers.has(column));
	if (missing.length > 0)
		return yield* new SheetInvalid({
			message: missing.map((column) => `Header: ${column}: Missing column`).join('\n')
		});
	const errors: string[] = [];
	const rows: WorkOrder[] = [];
	records.forEach((record, index) => {
		const serial = record.scheduled_for;
		const decoded = Schema.decodeUnknownResult(WORK_ORDER_ROW)(
			serial !== undefined && /^\d{1,6}$/.test(serial)
				? { ...record, scheduled_for: serialDay(serial) }
				: record,
			{ errors: 'all' }
		);
		if (decoded._tag === 'Success') {
			rows.push(decoded.success);
			return;
		}
		for (const issue of issues(decoded.failure.issue).issues) {
			const segment = issue.path?.[0] ?? '';
			const column = String(typeof segment === 'object' ? segment.key : segment);
			const detail =
				column === 'scheduled_for'
					? `${issue.message}; expected a calendar day (YYYY-MM-DD or an xlsx date serial).`
					: issue.message;
			errors.push(`Row ${index + 1}: ${column}: ${detail}`);
		}
	});
	if (errors.length > 0) return yield* new SheetInvalid({ message: errors.join('\n') });
	return rows;
});
