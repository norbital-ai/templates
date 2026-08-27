import { Effect, Schema } from 'effect';
import type { Pipelines } from './$types.js';

/**
 * `z.string().trim().min(1)`: trim first, then require a non-empty result.
 *
 * `Schema.Trimmed` would be the wrong port — it *rejects* a padded string rather than trimming it,
 * so a feed that pads its columns would fail the whole batch instead of importing cleanly.
 */
const trimmedRequired = Schema.decodeTo(Schema.String.check(Schema.isMinLength(1)))(Schema.Trim);

const customersSchema = Schema.Struct({
	customers: Schema.Array(
		Schema.Struct({
			external_code: trimmedRequired,
			name: trimmedRequired,
			currency: Schema.optionalKey(Schema.String),
			active: Schema.optionalKey(Schema.Boolean)
		})
	)
});

/**
 * The platform hands the import handler the delivered payload unvalidated — `input` is `unknown`
 * and nothing checks it against the declared `input` schema first — so the feed is decoded here.
 * A malformed page fails the batch instead of writing partial customers.
 */
const decodeCustomers = Schema.decodeUnknownEffect(customersSchema);

/**
 * Import the ERP's changed customers into `accounts`.
 *
 * The returned rows are written into this collection by the platform, which is what makes the
 * domain table the mirror. Rows already on file are skipped — the unique index on `external_code`
 * would reject them anyway, and a re-delivered page must be a skip, not a failed batch.
 */
export default {
	import: {
		description:
			'Mirrors the delivered ERP customer feed into accounts, skipping any customer whose external_code is already on file.',
		input: customersSchema,
		handler: ({ input }, api) =>
			Effect.gen(function* () {
				const { customers } = yield* decodeCustomers(input);
				const codes = customers.map((customer) => customer.external_code);

				const existing = yield* api.db.accounts.findMany({
					where: { external_code: { in: codes } },
					columns: { external_code: true },
					limit: 20000
				});
				const known = new Set(existing.map((row) => row.external_code));

				return customers
					.filter((customer) => !known.has(customer.external_code))
					.map((customer) => ({
						external_code: customer.external_code,
						name: customer.name,
						industry: null,
						website: null,
						phone: null,
						currency: customer.currency ?? null,
						address: null,
						active: customer.active ?? true
					}));
			})
	}
} satisfies Pipelines;
