import { Effect, Schema } from 'effect';
import { dedupeHolidayRows } from '../../lib/holiday-rows.js';
import type { Pipelines } from './$types.js';

const importSchema = Schema.Struct({
	rows: Schema.Array(
		Schema.Struct({
			jurisdiction_code: Schema.String,
			date: Schema.String,
			name: Schema.String,
			original_date: Schema.NullOr(Schema.String),
			source: Schema.NullOr(Schema.String)
		})
	)
});

export default {
	import: {
		description:
			'Loads holidays from the holidays spreadsheet: one row per jurisdiction and day. A day the jurisdiction already has is skipped, never duplicated or overwritten. Imported rows arrive unpublished.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const payload = Schema.decodeUnknownSync(importSchema)(input);
				const { inserts } = yield* dedupeHolidayRows(api, payload.rows);
				return inserts.map((row) => ({
					jurisdiction_code: row.jurisdiction_code,
					date: row.date,
					name: row.name,
					original_date: row.original_date,
					source: row.source ?? 'spreadsheet'
				}));
			})
	}
} satisfies Pipelines;
