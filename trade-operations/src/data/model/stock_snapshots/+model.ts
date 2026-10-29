import { model } from '@norbital-ai/bolt';
import { logisticsProduct } from '../../../lib/logistics.js';
import { columns, readSource, SourceRowInvalid } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
export default model('stock_snapshots', {
	description: 'stock snapshots',
	label: 'external_code',
	fields: {
		lot_number: { kind: 'text', optional: true },
		currency: { kind: 'currency', optional: true },
		unit_cost: { kind: 'decimal', scale: 8, optional: true },
		external_code: {
			kind: 'text'
		},
		unit: {
			kind: 'text',
			optional: true
		},
		on_hand: {
			kind: 'decimal',
			scale: 3
		},
		erp_committed: {
			kind: 'decimal',
			scale: 3,
			optional: true
		},
		as_of: {
			kind: 'instant'
		},
		orders_as_of: {
			kind: 'instant',
			optional: true
		},
		source: { kind: 'ref', to: 'sys_integration', where: { integration: { eq: 'kingdee' } } },
		product: { kind: 'ref', to: 'products' },
		warehouse: { kind: 'ref', to: 'warehouses' }
	},
	key: ['source', 'external_code'],
	// availability names each snapshot's product and warehouse
	search: { text: ['product', 'warehouse', 'lot_number', 'external_code'] },
	read: {
		stock_snapshots: { fields: 'all' },
		'stock_snapshots.product': { fields: 'all' },
		'stock_snapshots.warehouse': { fields: 'all' }
	},
	outputs: {
		logistics: {
			stock_snapshots: { fields: 'all' },
			'stock_snapshots.product': { fields: logisticsProduct },
			'stock_snapshots.warehouse': { fields: 'all' }
		}
	},
	syncs: {
		kingdee: {
			with: 'kingdee',
			read: function* ({ cursor, instance }, ctx) {
				const own = { source: { eq: instance } };
				const { products, warehouses } = yield* ctx.db.query({
					products: { where: own, fields: ['external_code'] },
					warehouses: { where: own, fields: ['external_code'] }
				});
				return yield* readSource(projections.stock_snapshots, cursor, ctx, (row) => {
					const r = columns(row);
					const product = products.rows.find((p) => p.external_code === r.text('product_code'));
					const warehouse = warehouses.rows.find(
						(w) => w.external_code === r.text('warehouse_code')
					);
					if (!product || !warehouse)
						throw new SourceRowInvalid({
							column: '$row',
							reason: 'Stock requires its synced product and warehouse'
						});
					return {
						external_code: r.text('external_code'),
						lot_number: r.text('lot_number', null),
						unit_cost: r.decimal('unit_cost', null),
						currency: r.currency('currency', null),
						unit: r.text('unit', null),
						on_hand: r.decimal('on_hand'),
						erp_committed: r.decimal('erp_committed', null),
						as_of: r.instant('as_of'),
						orders_as_of: r.instant('orders_as_of', null),
						product: product.id,
						warehouse: warehouse.id
					};
				});
			}
		}
	}
});
