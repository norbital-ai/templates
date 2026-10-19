import { Effect } from 'effect';
import { collection, type QueryCtx } from '@norbital-ai/bolt';
import { d } from '../../../lib/commercial.js';
import { isMasked } from '../../../lib/access.js';
import { availability } from '../../../lib/stock.js';
const output = {
	kind: 'list',
	of: {
		kind: 'object',
		fields: {
			product: { kind: 'id', of: 'products' },
			product_name: { kind: 'text' },
			warehouse_name: { kind: 'text' },
			warehouse: { kind: 'id', of: 'warehouses' },
			unit: { kind: 'text' },
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
const c = collection('stock_snapshots', {
	read: { fields: 'all' },
	queries: {
		erp_availability: {
			input: {},
			output,
			description: 'Current stock availability.'
		},
		projected_availability: {
			input: {},
			output,
			description: 'Stock available after open-order commitments.'
		}
	}
});
export default c;
function quantities(result: ReturnType<typeof availability>) {
	return {
		...result,
		sellable: result.sellable === null ? null : d(result.sellable),
		local_committed: result.local_committed === null ? null : d(result.local_committed),
		projected: result.projected === null ? null : d(result.projected)
	};
}
const sources = Effect.fnUntraced(function* (ctx: QueryCtx) {
	const { stock, settings, products, warehouses } = yield* ctx.read({
		stock: { collection: 'stock_snapshots', all: true },
		products: {
			collection: 'products',
			where: { id: { in: { member: 'stock', field: 'product' } } },
			select: { name: true },
			all: true
		},
		warehouses: {
			collection: 'warehouses',
			where: { id: { in: { member: 'stock', field: 'warehouse' } } },
			select: { name: true },
			all: true
		},
		settings: { collection: 'commercial_settings', where: { code: { eq: 'default' } }, limit: 1 }
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
c.query('erp_availability', function* (_, ctx: QueryCtx) {
	const { stock, freshMinutes } = yield* sources(ctx);
	return stock.map((s) => ({ ...s, ...quantities(availability(s, ctx.now, freshMinutes)) }));
});
c.query('projected_availability', function* (_, ctx: QueryCtx) {
	const { stock, freshMinutes } = yield* sources(ctx);
	const { orders, lines, receipts, delivered } = yield* ctx.read({
		orders: {
			collection: 'orders',
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
			collection: 'order_lines',
			select: { order: true, product: true, unit: true, quantity: true },
			all: true
		},
		receipts: {
			collection: 'ext_sales_orders',
			select: { order: true, status: true, agreement_hash: true, source_updated_at: true },
			all: true
		},
		delivered: {
			collection: 'transactions',
			where: { kind: { eq: 'delivery' }, status: { eq: 'issued' } },
			select: { order: true, items: true },
			all: true
		}
	});
	return stock.map((s) => ({
		...s,
		...quantities(
			availability(s, ctx.now, freshMinutes, {
				orders: orders.rows,
				lines: lines.rows,
				receipts: receipts.rows,
				delivered: delivered.rows.flatMap((row) =>
					(isMasked(row.items)
						? [
								...lines.rows.filter((line) => line.order === row.order),
								...(
									orders.rows.find((order) => order.id === row.order)?.operational_contracts ?? []
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
});
