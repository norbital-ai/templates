import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { isMasked, model, type QueryCtx } from '@norbital-ai/bolt';

import { availability } from '../../../lib/stock.js';
import { columns, readSource, SourceRowInvalid } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
const output = {
	kind: 'list',
	of: {
		kind: 'object',
		fields: {
			product: { kind: 'id', of: 'products' },
			product_name: { kind: 'text' },
			warehouse_name: { kind: 'text' },
			warehouse: { kind: 'id', of: 'warehouses' },
			unit: { kind: 'text', optional: true },
			on_hand: { kind: 'decimal', scale: 3 },
			erp_committed: { kind: 'decimal', scale: 3, optional: true },
			as_of: { kind: 'instant' },
			orders_as_of: { kind: 'instant', optional: true },
			sellable: { kind: 'decimal', scale: 3, optional: true },
			local_committed: { kind: 'decimal', scale: 3, optional: true },
			projected: { kind: 'decimal', scale: 3, optional: true },
			reason: {
				kind: 'enum',
				values: [
					'available',
					'erp_only',
					'stale_source',
					'missing_commitments',
					'unit_mismatch',
					'delivery_unreconciled',
					'contract_unreconciled'
				]
			}
		}
	}
} as const;
function quantities(result: ReturnType<typeof availability>) {
	return {
		...result,
		sellable: result.sellable === null ? null : Decimal.of(result.sellable),
		local_committed: result.local_committed === null ? null : Decimal.of(result.local_committed),
		projected: result.projected === null ? null : Decimal.of(result.projected)
	};
}
const sources = Effect.fnUntraced(function* (ctx: QueryCtx) {
	const { stock, settings, products, warehouses } = yield* ctx.query({
		stock: { from: 'stock_snapshots', all: true },
		products: {
			from: 'products',
			where: { id: { in: { member: 'stock', field: 'product' } } },
			select: { name: true },
			all: true
		},
		warehouses: {
			from: 'warehouses',
			where: { id: { in: { member: 'stock', field: 'warehouse' } } },
			select: { name: true },
			all: true
		},
		settings: { from: 'commercial_settings', where: { code: { eq: 'default' } }, limit: 1 }
	});
	if (!settings.rows[0]) return yield* ctx.refuse('errors.configuration_missing');
	return {
		stock: stock.rows.map((s) => ({
			...s,
			product_name: products.rows.find((p) => p.id === s.product)?.name ?? '',
			warehouse_name: warehouses.rows.find((w) => w.id === s.warehouse)?.name ?? ''
		})),
		freshMinutes: settings.rows[0].stock_fresh_minutes
	};
});
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
	read: 'all',
	queries: {
		erp_availability: {
			input: { as_of: { kind: 'instant' } },
			output,
			description: 'Stock availability at an instant.',
			run: function* (input, ctx) {
				const { stock, freshMinutes } = yield* sources(ctx);
				return stock.map((s) => ({
					...s,
					...quantities(availability(s, input.as_of, freshMinutes))
				}));
			}
		},
		projected_availability: {
			input: { as_of: { kind: 'instant' } },
			output,
			description: 'Stock available at an instant after open-order commitments.',
			run: function* (input, ctx) {
				const { stock, freshMinutes } = yield* sources(ctx);
				const { orders, lines, receipts, delivered } = yield* ctx.query({
					orders: {
						from: 'orders',
						select: {
							warehouse: true,
							direction: true,
							status: true,
							sealed_at: true,
							operational_contracts: true,
							seal_hash: true
						},
						all: true
					},
					lines: {
						from: 'order_lines',
						select: { order: true, product: true, unit: true, quantity: true },
						all: true
					},
					receipts: {
						from: 'ext_sales_orders',
						select: { order: true, status: true, agreement_hash: true, source_updated_at: true },
						all: true
					},
					delivered: {
						from: 'transactions',
						where: { kind: { eq: 'delivery' }, status: { eq: 'issued' } },
						select: { order: true, items: true },
						all: true
					}
				});
				return stock.map((s) => ({
					...s,
					...quantities(
						availability(s, input.as_of, freshMinutes, {
							orders: orders.rows,
							lines: lines.rows,
							receipts: receipts.rows,
							delivered: delivered.rows.flatMap((row) =>
								(isMasked(row.items)
									? [
											...lines.rows.filter((line) => line.order === row.order),
											...(
												orders.rows.find((order) => order.id === row.order)
													?.operational_contracts ?? []
											).flatMap((version) => version.lines)
										].map((line) => ({ order_line_id: line.id, quantity: '1' }))
									: (row.items ?? [])
								).map((item) => ({
									order_line: item.order_line_id,
									quantity: item.quantity
								}))
							)
						})
					)
				}));
			}
		}
	},
	syncs: {
		kingdee: {
			with: 'kingdee',
			read: function* ({ cursor, instance }, ctx) {
				const own = { source: { eq: instance } };
				const { products, warehouses } = yield* ctx.db.query({
					products: { from: 'products', where: own, select: { external_code: true }, all: true },
					warehouses: { from: 'warehouses', where: own, select: { external_code: true }, all: true }
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
