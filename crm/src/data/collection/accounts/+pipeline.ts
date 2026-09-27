import { pipeline } from '@norbital-ai/bolt';
import { CURRENCIES } from '../../../lib/currency.js';
import { masterRecords } from '../../../lib/erp-feed.js';

/** The ERP's changed customers, mirrored into `accounts`. */
export default pipeline('accounts', {
	import: {
		description:
			'Mirrors the delivered ERP customer feed into accounts, skipping any customer whose external_code is already on file.',
		input: {
			customers: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						external_code: { kind: 'text' },
						name: { kind: 'text' },
						currency: { kind: 'enum', values: CURRENCIES, optional: true },
						active: { kind: 'bool', optional: true }
					}
				}
			}
		},
		records: (input) => masterRecords(input.customers),
		known: (ctx, keys) =>
			ctx
				.read('accounts', { where: { external_code: { in: keys } }, all: true })
				.then((page) => page.rows),
		map: (customer, { known }) =>
			customer.external_code in known
				? null
				: {
						external_code: customer.external_code,
						name: customer.name,
						currency: customer.currency ?? null,
						active: customer.active ?? true
					},
		onConflict: 'keep'
	}
});
