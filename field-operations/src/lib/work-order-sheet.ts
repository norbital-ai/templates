import { Effect, Schema } from 'effect';
import { columns, decode } from '@norbital-ai/std/sheet';
import type { StartInput } from '@norbital-ai/bolt';

type Row = StartInput<'job_assignments_import_work_orders'>['rows'][number];
const WORK_ORDER_COLUMNS = columns({
	site: 'text',
	postal_code: { optional: 'text' },
	unit_number: { optional: 'text' },
	latitude: { optional: 'decimal' },
	longitude: { optional: 'decimal' },
	scheduled_for: 'date',
	title: 'text',
	nature: { optional: 'text' },
	description: { optional: 'text' },
	assignee_contact: { optional: 'text' },
	external_ref: { optional: 'text' }
});
export class SheetInvalid extends Schema.TaggedError<SheetInvalid>()('SheetInvalid', {
	message: Schema.String
}) {}
/** Decode the complete sheet once, before the first write. */
export const decodeWorkOrders = Effect.fnUntraced(function* (
	records: readonly Record<string, string>[]
) {
	const headers = [...new Set(records.flatMap((row) => Object.keys(row)))];
	const cells = [
		headers,
		...records.map((row) =>
			headers.map((header) => {
				const value = row[header] ?? null;
				return header === 'scheduled_for' && value !== null && /^\d{1,6}$/.test(value)
					? Schema.decodeUnknownSync(Schema.NumberFromString)(value)
					: value;
			})
		)
	];
	const decoded = decode(cells, WORK_ORDER_COLUMNS);
	if (decoded.errors.length > 0)
		return yield* new SheetInvalid({
			message: decoded.errors
				.map((error) => {
					const where = error.row === 1 ? 'Header' : `Row ${error.row - 1}`;
					const detail =
						error.column === 'scheduled_for'
							? `${error.message}; expected a calendar day (YYYY-MM-DD or an xlsx date serial).`
							: error.message;
					return `${where}: ${error.column}: ${detail}`;
				})
				.join('\n')
		});
	return decoded.rows.map((row): Row => ({
		...row,
		latitude: row.latitude?.toNumber() ?? null,
		longitude: row.longitude?.toNumber() ?? null
	}));
});
