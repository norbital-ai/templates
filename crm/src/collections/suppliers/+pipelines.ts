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

const vendorsSchema = Schema.Struct({
	vendors: Schema.Array(
		Schema.Struct({
			external_code: trimmedRequired,
			name: trimmedRequired,
			currency: Schema.optionalKey(
				Schema.Literals(['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD'])
			),
			payment_terms_days: Schema.optionalKey(
				Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(365))
			),
			active: Schema.optionalKey(Schema.Boolean)
		})
	)
});

/**
 * Import the ERP's changed vendors into `suppliers`.
 *
 * The returned rows are written into this collection by the platform, which is what makes the
 * domain table the mirror.
 */
export default {
	import: mirrorImport({
		description:
			'Mirrors the delivered ERP vendor feed into suppliers, skipping any vendor whose external_code is already on file.',
		input: vendorsSchema,
		records: (page) => page.vendors,
		known: (api, codes) =>
			api.db.suppliers.findMany({
				where: { external_code: { in: codes } },
				columns: { external_code: true },
				limit: 20000
			}),
		map: (vendor) => ({
			...erpMasterColumns({ ...vendor, code: vendor.external_code }),
			currency: vendor.currency,
			payment_terms_days: vendor.payment_terms_days
		})
	})
} satisfies Pipelines;
