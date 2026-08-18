import { Effect, Schema } from 'effect';
import type { Pipelines } from './$types.js';

/**
 * `z.string().trim().min(1)`: trim first, then require a non-empty result.
 *
 * `Schema.Trimmed` would be the wrong port — it *rejects* a padded string rather than trimming it,
 * so a feed that pads its columns would fail the whole batch instead of importing cleanly.
 */
const trimmedRequired = Schema.decodeTo(Schema.String.check(Schema.isMinLength(1)))(Schema.Trim);

const vendorsSchema = Schema.Struct({
	vendors: Schema.Array(
		Schema.Struct({
			external_code: trimmedRequired,
			name: trimmedRequired,
			currency: Schema.optionalKey(Schema.String),
			payment_terms_days: Schema.optionalKey(
				Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(365))
			),
			active: Schema.optionalKey(Schema.Boolean)
		})
	)
});

/**
 * The platform hands the import handler the delivered payload unvalidated — `input` is `unknown`
 * and nothing checks it against the declared `input` schema first — so the feed is decoded here.
 * A malformed page fails the batch instead of writing partial vendors.
 */
const decodeVendors = Schema.decodeUnknownEffect(vendorsSchema);

/**
 * Import the ERP's changed vendors into `suppliers`.
 *
 * The returned rows are written into this collection by the platform, which is what makes the
 * domain table the mirror. Rows already on file are skipped — the unique index on `external_code`
 * would reject them anyway, and a re-delivered page must be a skip, not a failed batch.
 */
export default {
	import: {
		description:
			'Mirrors the delivered ERP vendor feed into suppliers, skipping any vendor whose external_code is already on file.',
		input: vendorsSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const { vendors } = yield* decodeVendors(input);
				const codes = vendors.map((vendor) => vendor.external_code);

				const existing = yield* api.db.query.suppliers.findMany({
					where: { external_code: { in: codes } },
					columns: { external_code: true },
					limit: 20000
				});
				const known = new Set(existing.map((row) => row.external_code));

				return vendors
					.filter((vendor) => !known.has(vendor.external_code))
					.map((vendor) => ({
						external_code: vendor.external_code,
						code: vendor.external_code,
						name: vendor.name,
						category: null,
						currency: vendor.currency ?? null,
						payment_terms_days: vendor.payment_terms_days ?? null,
						phone: null,
						email: null,
						address: null,
						active: vendor.active ?? true
					}));
			})
	}
} satisfies Pipelines;
