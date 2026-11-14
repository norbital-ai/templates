import { sync } from '@norbital-ai/bolt';
import {
	columns,
	readSource,
	SourceRowInvalid,
	fromSource
} from '../../../../integration/kingdee/polling.js';
import { projections } from '../../../../integration/kingdee/projections.js';

export default sync('stock_snapshots', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	read: function* ({ cursor, instance }, ctx) {
		const own = { source: { eq: instance } };
		const { products, warehouses } = yield* ctx.query({
			products: { where: own, fields: ['external_code'] },
			warehouses: { where: own, fields: ['external_code'] }
		});
		return fromSource(
			yield* readSource(projections.stock_snapshots, cursor, ctx, (row) => {
				const r = columns(row);
				const product = products.rows.find((p) => p.external_code === r.text('product_code'));
				const warehouse = warehouses.rows.find((w) => w.external_code === r.text('warehouse_code'));
				if (!product || !warehouse)
					throw new SourceRowInvalid({
						column: '$row',
						reason: 'Stock requires its synced product and warehouse'
					});
				return {
					external_code: r.text('external_code'),
					lot_number: r.text('lot_number', null),
					unit_cost: r.decimalText('unit_cost', null),
					currency: r.currency('currency', null),
					unit: r.text('unit', null),
					on_hand: r.decimalText('on_hand'),
					erp_committed: r.decimalText('erp_committed', null),
					as_of: r.instant('as_of'),
					orders_as_of: r.instant('orders_as_of', null),
					product: product.id,
					warehouse: warehouse.id
				};
			}),
			instance
		);
	}
});
