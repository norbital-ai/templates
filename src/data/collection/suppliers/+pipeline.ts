import { pipeline } from '@norbital-ai/bolt';
import { masterRecords } from '../../../lib/erp-feed.js';

/** The ERP's changed vendors, mirrored into `suppliers`; the ERP vendor code is the supplier code. */
export default pipeline('suppliers', {
	import: {
		description:
			'Mirrors the delivered ERP vendor feed into suppliers, skipping any vendor whose external_code is already on file.',
		input: {
			vendors: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						external_code: { kind: 'text' },
						name: { kind: 'text' },
						currency: { kind: 'currency', optional: true },
						payment_terms_days: { kind: 'int', min: 0, max: 365, optional: true },
						active: { kind: 'bool', optional: true }
					}
				}
			}
		},
		records: (input) => masterRecords(input.vendors),
		// the codes already on file, read once per feed (the value crosses as plain data)
		known: (ctx, records) =>
			ctx
				.read('suppliers', {
					where: { external_code: { in: records.map((r) => r.external_code) } },
					select: { external_code: true },
					all: true
				})
				.then((page) => Object.fromEntries(page.rows.map((r) => [r.external_code, true]))),
		map: (vendor, { known }) =>
			vendor.external_code in known
				? null
				: {
						external_code: vendor.external_code,
						code: vendor.external_code,
						name: vendor.name,
						currency: vendor.currency ?? null,
						payment_terms_days: vendor.payment_terms_days ?? null,
						active: vendor.active ?? true
					},
		onConflict: 'keep'
	}
});
