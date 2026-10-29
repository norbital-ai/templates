import { Decimal } from '@norbital-ai/std/decimal';
import { logisticsLine } from '../../../lib/logistics.js';
import { model, type Id, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { currentAgreement } from '../../../lib/agreements.js';
import { contractEntryId, draftLineMatches, draftLineTarget } from '../../../lib/contract-draft.js';
import { price } from '../../../lib/commercial.js';
const cells = ['quantity', 'unit_price', 'discount_pct', 'tax_rate'] as const;
type Cell = Decimal | number | `${number}`;
/** One line to price: its order and product, the cells the writer sent, and the stored line an update changes. */
type Pricing = {
	readonly order: Id<'orders'>;
	readonly product: Id<'products'>;
	readonly cells: { readonly [K in (typeof cells)[number]]?: Cell | null };
	readonly before: StoredRow<'order_lines'> | null;
	readonly source_entry_id?: string | null;
};
/**
 * Prices every line against its draft order's currency, ledger and floor catalogue (two reads for the whole batch):
 * the catalogue fills a missing price and tax rate, and a line keeps the product facts it was created with.
 */
const priced = Effect.fnUntraced(function* (
	ctx: WriteCtx<'order_lines'>,
	lines: readonly Pricing[]
) {
	const productIds = lines.map((l) => l.product);
	const {
		products,
		pricing_floors: floors,
		warehouses,
		ext_sales_orders: salesOrders,
		ext_purchase_orders: purchaseOrders
	} = yield* ctx.db.query({
		products: { where: { id: { in: productIds } } },
		pricing_floors: { where: { product: { in: productIds } } },
		warehouses: {},
		ext_sales_orders: {
			where: { order: { in: lines.map((line) => line.order) } },
			fields: ['order']
		},
		ext_purchase_orders: {
			where: { order: { in: lines.map((line) => line.order) } },
			fields: ['order']
		}
	});
	const orders = yield* ctx.db.after('orders', { id: { in: lines.map((l) => l.order) } });
	const out: Pick<
		StoredRow<'order_lines'>,
		| 'source_entry_id'
		| 'quantity'
		| 'unit_price'
		| 'discount_pct'
		| 'tax_rate'
		| 'product_code'
		| 'product_name'
		| 'unit'
		| 'currency'
		| 'net'
		| 'tax'
		| 'total'
		| 'floor_net'
		| 'floor_on'
		| 'commission_basis_unit'
		| 'commission_factor'
	>[] = [];
	for (const {
		order: orderId,
		product: productId,
		cells: input,
		before: old,
		source_entry_id: requestedEntry
	} of lines) {
		const order = orders.find((o) => o.id === orderId);
		const product = products.rows.find((p) => p.id === productId);
		if (
			!order ||
			order.archived ||
			order.status !== 'draft' ||
			([...salesOrders.rows, ...purchaseOrders.rows].some((row) => row.order === orderId) &&
				!order.contract_versions?.length)
		)
			return yield* ctx.refuse('errors.order_sealed');
		if (!product?.active) return yield* ctx.refuse('errors.product_inactive');
		if (product.source !== order.ledger)
			return yield* ctx.refuse('errors.ledger_mismatch', { field: 'product' });
		if (order.currency !== product.currency && input.unit_price == null && !old)
			return yield* ctx.refuse('errors.currency_price');
		const source_entry_id =
			requestedEntry !== undefined ? requestedEntry : (old?.source_entry_id ?? null);
		if (
			!order.draft_setup &&
			requestedEntry !== undefined &&
			source_entry_id !== (old?.source_entry_id ?? null)
		)
			return yield* ctx.refuse('errors.evidence_sealed');
		if (old?.source_entry_id && source_entry_id !== old.source_entry_id)
			return yield* ctx.refuse('errors.evidence_sealed');
		const quantity = input.quantity ?? old?.quantity;
		const unit_price =
			input.unit_price ??
			old?.unit_price ??
			(order.direction === 'sales' ? product.unit_price : null);
		const discount_pct = input.discount_pct ?? old?.discount_pct ?? Decimal.of(0);
		const tax_rate = input.tax_rate ?? old?.tax_rate ?? product.tax_rate;
		const unit = old?.unit ?? product.unit;
		if (unit == null || unit.trim() === '')
			return yield* ctx.refuse('errors.unit_mismatch', { field: 'product' });
		if (tax_rate == null) return yield* ctx.refuse('errors.percentage', { field: 'tax_rate' });
		if (quantity == null || Decimal.of(quantity).lte(0))
			return yield* ctx.refuse('errors.quantity_positive', { field: 'quantity' });
		if (unit_price === null || unit_price === undefined || Decimal.of(unit_price).lt(0))
			return yield* ctx.refuse('errors.price_required', { field: 'unit_price' });
		if (
			Decimal.of(discount_pct).lt(0) ||
			Decimal.of(discount_pct).gt(100) ||
			Decimal.of(tax_rate).lt(0) ||
			Decimal.of(tax_rate).gt(100)
		)
			return yield* ctx.refuse('errors.percentage');
		let setupTarget;
		if (order.draft_setup) {
			const current = currentAgreement(order);
			setupTarget = current?.snapshot.lines.find((line) =>
				source_entry_id ? contractEntryId(current, line) === source_entry_id : line.id === old?.id
			);
			if (
				!current ||
				current.seal_hash !== order.draft_setup ||
				!setupTarget ||
				!draftLineMatches(current, setupTarget, {
					product: productId,
					source_entry_id,
					unit,
					quantity: Decimal.of(quantity),
					unit_price: Decimal.of(unit_price),
					discount_pct: Decimal.of(discount_pct),
					tax_rate: Decimal.of(tax_rate)
				})
			)
				return yield* ctx.refuse('errors.contract_setup');
		}
		const group = warehouses.rows.find((v) => v.id === order.warehouse)?.group_code;
		const floor = floors.rows
			.filter(
				(f) =>
					f.product === product.id &&
					f.currency === order.currency &&
					f.group_code === group &&
					f.effective_on <= order.ordered_on &&
					Decimal.of(f.minimum_quantity).lte(quantity)
			)
			.sort(
				(a, b) =>
					b.effective_on.localeCompare(a.effective_on) ||
					Decimal.of(b.minimum_quantity).cmp(a.minimum_quantity)
			)[0];
		if (floor && floor.unit !== unit) return yield* ctx.refuse('errors.unit_mismatch');
		const floor_net = floor
			? floor.tax_inclusive
				? Decimal.of(floor.floor_price).div(
						Decimal.of(1).plus(Decimal.of(floor.tax_rate).div(100, 6)),
						8
					)
				: floor.floor_price
			: null;
		out.push({
			source_entry_id,
			quantity: Decimal.of(quantity),
			unit_price: Decimal.of(unit_price),
			discount_pct: Decimal.of(discount_pct),
			tax_rate: Decimal.of(tax_rate),
			product_code: setupTarget?.product_code ?? old?.product_code ?? product.external_code,
			product_name: setupTarget?.product_name ?? old?.product_name ?? product.name,
			unit,
			...price(order, { quantity, unit_price, discount_pct, tax_rate }),
			floor_net,
			floor_on: floor?.effective_on ?? null,
			commission_basis_unit: old?.commission_basis_unit ?? product.commission_basis_unit,
			commission_factor: old?.commission_factor ?? product.commission_factor
		});
	}
	return out;
});
export default model('order_lines', {
	description: 'order lines',
	label: ['product_name', 'quantity'],
	fields: {
		order: { kind: 'ref', to: 'orders', inverse: 'lines', owned: true },
		product: { kind: 'ref', to: 'products' },
		source_entry_id: { kind: 'text', optional: true, hidden: true },
		product_code: {
			kind: 'text'
		},
		product_name: {
			kind: 'text'
		},
		unit: {
			kind: 'text'
		},
		currency: {
			kind: 'currency'
		},
		quantity: {
			kind: 'decimal',
			scale: 3,
			min: 0
		},
		unit_price: {
			kind: 'money',
			currency: 'currency',
			scale: 4
		},
		discount_pct: {
			kind: 'decimal',
			scale: 2,
			default: 0,
			min: 0,
			max: 100
		},
		tax_rate: {
			kind: 'decimal',
			scale: 2,
			min: 0,
			max: 100
		},
		net: {
			kind: 'money',
			currency: 'currency'
		},
		tax: {
			kind: 'money',
			currency: 'currency'
		},
		total: {
			kind: 'money',
			currency: 'currency'
		},
		floor_net: {
			kind: 'money',
			currency: 'currency',
			scale: 8,
			optional: true
		},
		floor_on: {
			kind: 'date',
			optional: true
		},
		commission_factor: {
			kind: 'decimal',
			scale: 6,
			optional: true,
			min: 0
		},
		commission_basis_unit: {
			kind: 'text',
			optional: true
		}
	},
	check: {
		unit_price_nonnegative: {
			unit_price: {
				gte: '0'
			}
		}
	},
	search: { text: ['product', 'product_code'] },
	read: {
		order_lines: { fields: 'all' },
		'order_lines.product': { fields: ['name', 'external_code'] },
		'order_lines.order': { fields: ['ledger', 'direction'] }
	},
	outputs: {
		logistics: {
			order_lines: { fields: logisticsLine },
			'order_lines.product': { fields: ['name', 'external_code'] },
			'order_lines.order': { fields: ['ledger', 'direction'] }
		}
	},
	// a line created through its order's `'orders.lines'` layer runs this after the order's own `create.transform`
	create: {
		columns: { order_lines: ['order', 'product', ...cells, 'source_entry_id'] },
		filled: { order_lines: ['unit_price', 'tax_rate'] },
		transform: function* (rows, ctx) {
			const derived = yield* priced(
				ctx,
				rows.map((row) => ({
					order: row.order,
					product: row.product,
					cells: row,
					before: null,
					...(row.source_entry_id !== undefined ? { source_entry_id: row.source_entry_id } : {})
				}))
			);
			return rows.map((row, i) => ({ ...row, ...derived[i] }));
		}
	},
	update: {
		columns: { order_lines: [...cells, 'source_entry_id'] },
		transform: function* (changes, ctx) {
			const derived = yield* priced(
				ctx,
				changes.map(({ before, set }) => ({
					order: before.order,
					product: before.product,
					cells: set,
					before,
					...(set.source_entry_id !== undefined ? { source_entry_id: set.source_entry_id } : {})
				}))
			);
			return changes.map(({ set }, i) => ({ ...set, ...derived[i] }));
		}
	},
	delete: {
		check: function* (rows, ctx) {
			const orders = rows.map((row) => row.order);
			const parents = yield* ctx.db.after('orders', { id: { in: orders } });
			const { ext_sales_orders: salesOrders, ext_purchase_orders: purchaseOrders } =
				yield* ctx.db.query({
					ext_sales_orders: { where: { order: { in: orders } }, limit: 1 },
					ext_purchase_orders: { where: { order: { in: orders } }, limit: 1 }
				});
			for (const row of rows) {
				const parent = parents.find((order) => order.id === row.order);
				if (!parent?.draft_setup) continue;
				const current = currentAgreement(parent);
				const target = current ? draftLineTarget(current, row) : undefined;
				if (
					!current ||
					current.seal_hash !== parent.draft_setup ||
					(target && target.product === row.product && target.unit === row.unit)
				)
					return yield* ctx.refuse('errors.contract_setup');
			}
			if (
				parents.some((order) => order.archived || order.status !== 'draft') ||
				parents.some(
					(order) =>
						!order.contract_versions?.length &&
						[...salesOrders.rows, ...purchaseOrders.rows].some(
							(source) => source.order === order.id
						)
				)
			)
				return yield* ctx.refuse('errors.order_sealed');
		}
	}
});
