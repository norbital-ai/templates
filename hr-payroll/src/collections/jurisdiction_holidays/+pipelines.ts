import { Effect, Schema } from 'effect';
import { dedupeHolidayRows } from '../../lib/holiday-rows.js';
import type { Pipelines } from './$types.js';

/**
 * Two documents come through this door: the holidays spreadsheet, and a publication decision for
 * rows a person selected in the table. Both answer with the rows to write, which is what an import
 * pipeline is — so the bulk publish needs no write of its own in the browser.
 */
const importSchema = Schema.Union([
	Schema.Struct({
		rows: Schema.Array(
			Schema.Struct({
				jurisdiction_code: Schema.String,
				date: Schema.String,
				name: Schema.String,
				original_date: Schema.NullOr(Schema.String),
				source: Schema.NullOr(Schema.String)
			})
		)
	}),
	Schema.Struct({ publish: Schema.Array(Schema.String), published: Schema.Boolean })
]);

export default {
	import: {
		description:
			'Loads holidays from the holidays spreadsheet — one row per jurisdiction and day; a day the jurisdiction already has is skipped, never duplicated or overwritten, and imported rows arrive unpublished — or publishes and unpublishes the holidays a person selected.',
		input: importSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const payload = Schema.decodeUnknownSync(importSchema)(input);
				if ('publish' in payload) {
					const publishedAt = payload.published ? new Date().toISOString() : null;
					return payload.publish.map((id) => ({ id, published_at: publishedAt }));
				}
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
