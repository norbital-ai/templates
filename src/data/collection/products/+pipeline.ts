import { pipeline } from '@norbital-ai/bolt';
import { masterRecords } from '../../../lib/erp-feed.js';
import { dec } from '../../../lib/pricing.js';

/** The ERP's changed items, mirrored into `products`; the ERP item code is the catalogue code. */
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
						unit_price: { kind: 'number', min: 0, optional: true },
						active: { kind: 'bool', optional: true }
					}
				}
			}
		},
		records: (input) => masterRecords(input.items),
		known: (ctx, keys) =>
			ctx
				.read('products', { where: { external_code: { in: keys } }, all: true })
				.then((page) => page.rows),
		map: (item, { known }) =>
			item.external_code in known
				? null
				: {
						external_code: item.external_code,
						code: item.external_code,
						name: item.name,
						unit: item.unit ?? null,
						unit_price: item.unit_price == null ? null : dec(item.unit_price),
						active: item.active ?? true
					},
		onConflict: 'keep'
	}
});
