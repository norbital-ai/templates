import { Schema } from 'effect';
import { erpMasterColumns, mirrorImport } from '../../lib/erp-feed.js';
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
 * Import the ERP's changed items into `products`.
 *
 * The returned rows are written into this collection by the platform, which is what makes the
 * domain table the mirror. The ERP item code is the natural catalogue code; a tenant that uses its
 * own codes can set them in `map` instead.
 */
export default {
	import: mirrorImport({
		description:
			'Mirrors the delivered ERP item feed into the product catalogue, skipping any item whose external_code is already on file.',
		input: itemsSchema,
		records: (page) => page.items,
		known: (api, codes) =>
			api.db.products.findMany({
				where: { external_code: { in: codes } },
				columns: { external_code: true },
				limit: 20000
			}),
		map: (item) => ({
			...erpMasterColumns({ ...item, code: item.external_code }),
			unit: item.unit,
			unit_price: item.unit_price
		})
	})
} satisfies Pipelines;
