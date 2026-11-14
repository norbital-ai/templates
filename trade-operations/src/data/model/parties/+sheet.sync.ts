import { sync } from '@norbital-ai/bolt';
import { partyWorkbook } from '../../../lib/workbook.js';

export default sync('parties', 'sheet', {
	with: 'file',
	parser: ['xlsx', 'csv'],
	schema: partyWorkbook,
	write: function* (_input, ctx) {
		const { parties } = yield* ctx.query({
			parties: {
				fields: [
					'source',
					'external_code',
					'source_number',
					'name',
					'kind',
					'currency',
					'active',
					'address',
					'phone'
				],
				order_by: { external_code: 'asc' },
				limit: 10000
			}
		});
		return parties.rows.map((party) => ({
			ledger: party.source,
			external_code: party.external_code,
			source_number: party.source_number ?? '',
			name: party.name,
			kind: party.kind,
			currency: party.currency,
			active: party.active,
			address: party.address ?? '',
			phone: party.phone ?? ''
		}));
	}
});
