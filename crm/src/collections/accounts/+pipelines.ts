import { Schema } from 'effect';
import { mirrorImport } from '../../lib/erp-feed.js';
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
			currency: Schema.optionalKey(
				Schema.Literals(['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD'])
			),
			active: Schema.optionalKey(Schema.Boolean)
		})
	)
});

/**
 * Import the ERP's changed customers into `accounts`.
 *
 * The returned rows are written into this collection by the platform, which is what makes the
 * domain table the mirror.
 */
export default {
	import: mirrorImport({
		description:
			'Mirrors the delivered ERP customer feed into accounts, skipping any customer whose external_code is already on file.',
		input: customersSchema,
		records: (page) => page.customers,
		known: (api, codes) =>
			api.db.accounts.findMany({
				where: { external_code: { in: codes } },
				columns: { external_code: true },
				limit: 20000
			}),
		map: (customer) => ({
			external_code: customer.external_code,
			name: customer.name,
			currency: customer.currency,
			active: customer.active ?? true
		})
	})
} satisfies Pipelines;
