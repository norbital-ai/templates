import { sync } from '@norbital-ai/bolt';
import { warehouseWorkbook } from '../../../lib/workbook.js';

export default sync('warehouses', 'sheet', {
	with: 'file',
	parser: ['xlsx', 'csv'],
	schema: warehouseWorkbook,
	write: function* (_input, ctx) {
		const { warehouses } = yield* ctx.query({
			warehouses: {
				fields: ['source', 'external_code', 'source_number', 'name', 'group_code', 'active'],
				order_by: { external_code: 'asc' },
				limit: 10000
			}
		});
		return warehouses.rows.map((warehouse) => ({
			ledger: warehouse.source,
			external_code: warehouse.external_code,
			source_number: warehouse.source_number ?? '',
			name: warehouse.name,
			group_code: warehouse.group_code ?? '',
			active: warehouse.active
		}));
	}
});
