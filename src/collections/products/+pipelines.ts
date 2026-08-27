import { Effect, Schema } from 'effect';
import type { Pipelines } from './$types.js';

/**
 * `z.string().trim().min(1)`: trim first, then require a non-empty result.
 *
 * `Schema.Trimmed` would be the wrong port — it *rejects* a padded string rather than trimming it,
 * so a feed that pads its columns would fail the whole batch instead of importing cleanly.
 */
const trimmedRequired = Schema.decodeTo(Schema.String.check(Schema.isMinLength(1)))(Schema.Trim);

const itemsSchema = Schema.Struct({
	items: Schema.Array(
		Schema.Struct({
			external_code: trimmedRequired,
			name: trimmedRequired,
			unit: Schema.optionalKey(Schema.String),
			unit_price: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
			active: Schema.optionalKey(Schema.Boolean)
		})
	)
});

/**
 * The platform hands the import handler the delivered payload unvalidated — `input` is `unknown`
 * and nothing checks it against the declared `input` schema first — so the feed is decoded here.
 * A malformed page fails the batch instead of writing partial items.
 */
const decodeItems = Schema.decodeUnknownEffect(itemsSchema);

/**
 * Import the ERP's changed items into `products`.
 *
 * The returned rows are written into this collection by the platform, which is what makes the
 * domain table the mirror. Rows already on file are skipped — the unique index on `external_code`
 * would reject them anyway, and a re-delivered page must be a skip, not a failed batch.
 */
export default {
	import: {
		description:
			'Mirrors the delivered ERP item feed into the product catalogue, skipping any item whose external_code is already on file.',
		input: itemsSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const { items } = yield* decodeItems(input);
				const codes = items.map((item) => item.external_code);

				const existing = yield* api.db.products.findMany({
					where: { external_code: { in: codes } },
					columns: { external_code: true },
					limit: 20000
				});
				const known = new Set(existing.map((row) => row.external_code));

				return items
					.filter((item) => !known.has(item.external_code))
					.map((item) => ({
						external_code: item.external_code,
						// The ERP item code is the natural catalogue code; a tenant that uses its own
						// codes can set them here instead.
						code: item.external_code,
						name: item.name,
						description: null,
						unit: item.unit ?? null,
						unit_price: item.unit_price ?? null,
						active: item.active ?? true
					}));
			})
	}
} satisfies Pipelines;
