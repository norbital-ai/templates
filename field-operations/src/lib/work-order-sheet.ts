import { Effect, Schema } from 'effect';
import { columns, decode } from '@norbital-ai/std/sheet';
import { IdValue } from '@norbital-ai/std/kind';
import type { Id, InputOf } from '@norbital-ai/bolt';
import type { WORK_ORDER_ROW } from '../data/collection/job_assignments/+collection.js';

type Row = InputOf<typeof WORK_ORDER_ROW.fields>;
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
	assignee_user_id: { optional: 'text' },
	external_ref: { optional: 'text' }
});
export class SheetInvalid extends Schema.TaggedError<SheetInvalid>()('SheetInvalid', {
	message: Schema.String
}) {}
const UserId = Schema.toType(IdValue);
const MemberId = Schema.declare<Id<'sys_user'>>(
	(input): input is Id<'sys_user'> => Schema.is(Schema.String)(input) && Schema.is(UserId)(input)
);
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
		return yield* Effect.fail(
			new SheetInvalid({
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
			})
		);
	const identities = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.NullOr(UserId)))(
		decoded.rows.map((row) => row.assignee_user_id)
	).pipe(Effect.mapError((error) => new SheetInvalid({ message: String(error) })));
	const users = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.NullOr(MemberId)))(
		identities
	).pipe(Effect.mapError((error) => new SheetInvalid({ message: String(error) })));
	return decoded.rows.map((row, index): Row => ({
		...row,
		latitude: row.latitude?.toNumber() ?? null,
		longitude: row.longitude?.toNumber() ?? null,
		assignee_user_id: users[index] ?? null
	}));
});
