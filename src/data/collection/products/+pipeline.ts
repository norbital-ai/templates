import { pipeline } from '@norbital-ai/bolt';
import { masterRecords } from '../../../lib/erp-feed.js';
import { dec } from '../../../lib/pricing.js';

/** The ERP's changed items, mirrored into `products`; the ERP item code is the catalogue code, an item without a currency is priced in the workspace's. */
export default pipeline('products', {
	import: {
		description:
			'Mirrors the delivered ERP item feed into the product catalogue, skipping any item whose external_code is already on file.',
		input: {
			items: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						external_code: { kind: 'text' },
						name: { kind: 'text' },
						unit: { kind: 'text', optional: true },
						currency: { kind: 'currency', optional: true },
						unit_price: { kind: 'number', min: 0, optional: true },
						active: { kind: 'bool', optional: true }
					}
				}
			}
		},
		records: (input) => masterRecords(input.items),
		// the codes already on file, read once per feed (the value crosses as plain data)
		known: (ctx, records) =>
			ctx
				.read('products', {
					where: { external_code: { in: records.map((r) => r.external_code) } },
					select: { external_code: true },
					all: true
				})
				.then((page) => Object.fromEntries(page.rows.map((r) => [r.external_code, true]))),
		map: (item, { known }) =>
			item.external_code in known
				? null
				: {
						external_code: item.external_code,
						code: item.external_code,
						name: item.name,
						unit: item.unit ?? null,
						...(item.currency == null ? {} : { currency: item.currency }),
						unit_price: item.unit_price == null ? null : dec(item.unit_price),
						active: item.active ?? true
					},
		onConflict: 'keep'
	}
});
