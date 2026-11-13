import { model } from '../../../../../.norbital/models/order_lines.ts';
import { dec, div, text, type DecimalLike } from '../../../../lib/values.js';
import { logisticsLine } from '../../../../lib/logistics.js';
import { type Id, type StoredRow, type WriteCtx } from '@norbital-ai/bolt';
import { BigDecimal, Effect } from 'effect';
import { pushOrder, readKingdeeOrderLines } from '../../../../integration/kingdee/sales-orders.js';
import { price } from '../../../../lib/commercial.js';
import {
	printValueKind,
	orderedPrintValues,
	validPrintValues
} from '../../../../lib/print-details.js';
const cells = ['quantity', 'unit_price', 'discount_pct', 'tax_rate'] as const;
type Cell = DecimalLike;
/** One line to price: its order and product, the cells the writer sent, and the stored line an update changes. */
type Pricing = {
	readonly order: Id<'orders'>;
	readonly product: Id<'products'>;
	readonly cells: { readonly [K in (typeof cells)[number]]?: Cell | null } & {
		readonly print_values?: StoredRow<'order_lines'>['print_values'];
	};
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
		warehouses
	} = yield* ctx.query({
		products: { where: { id: { in: productIds } } },
		pricing_floors: { where: { product: { in: productIds } } },
		warehouses: {}
	});
	// an order created with its lines in the same act is read as the act leaves it
	const ids = [...new Set(lines.map((l) => l.order))];
	const stored = (yield* ctx.query({ orders: { where: { id: { in: ids } } } })).orders.rows;
	const pending = ids.filter((id) => !stored.some((order) => order.id === id));
	const orders = pending.length
		? [...stored, ...(yield* ctx.query.after('orders', { id: { in: pending } }))]
		: stored;
	const out: (Pick<
		StoredRow<'order_lines'>,
		| 'source_entry_id'
		| 'quantity'
		| 'unit_price'
		| 'discount_pct'
		| 'tax_rate'
		| 'product_code'
		| 'product_name'
		| 'product_spec'
		| 'unit'
		| 'currency'
		| 'net'
		| 'tax'
		| 'total'
		| 'floor_net'
		| 'floor_on'
		| 'commission_basis_unit'
		| 'commission_factor'
	> &
		Partial<Pick<StoredRow<'order_lines'>, 'print_values'>>)[] = [];
	for (const {
		order: orderId,
		product: productId,
		cells: input,
		before: old,
		source_entry_id: requestedEntry
	} of lines) {
		const order = orders.find((o) => o.id === orderId);
		const product = products.rows.find((p) => p.id === productId);
		if (!order || order.archived) return yield* ctx.refuse('errors.order_archived');
		if (!product?.active) return yield* ctx.refuse('errors.product_inactive');
		if (product.source !== order.ledger)
			return yield* ctx.refuse('errors.ledger_mismatch', { field: 'product' });
		if (order.currency !== product.currency && input.unit_price == null && !old)
			return yield* ctx.refuse('errors.currency_price');
		const source_entry_id =
			requestedEntry !== undefined ? requestedEntry : (old?.source_entry_id ?? null);
		// only the Kingdee read binds a line to its SO entry
		if (source_entry_id !== (old?.source_entry_id ?? null) && ctx.actor.kind !== 'system')
			return yield* ctx.refuse('errors.evidence_sealed');
		const quantity = input.quantity ?? old?.quantity;
		const unit_price =
			input.unit_price ??
			old?.unit_price ??
			(order.direction === 'sales' ? product.unit_price : null);
		const discount_pct = input.discount_pct ?? old?.discount_pct ?? '0';
		const tax_rate = input.tax_rate ?? old?.tax_rate ?? product.tax_rate;
		const unit = old?.unit ?? product.unit;
		if (unit == null || unit.trim() === '')
			return yield* ctx.refuse('errors.unit_mismatch', { field: 'product' });
		if (tax_rate == null) return yield* ctx.refuse('errors.percentage', { field: 'tax_rate' });
		if (quantity == null || BigDecimal.isLessThanOrEqualTo(dec(quantity), dec(0)))
			return yield* ctx.refuse('errors.quantity_positive', { field: 'quantity' });
		if (unit_price === null || unit_price === undefined || BigDecimal.isNegative(dec(unit_price)))
			return yield* ctx.refuse('errors.price_required', { field: 'unit_price' });
		if (
			BigDecimal.isNegative(dec(discount_pct)) ||
			BigDecimal.isGreaterThan(dec(discount_pct), dec(100)) ||
			BigDecimal.isNegative(dec(tax_rate)) ||
			BigDecimal.isGreaterThan(dec(tax_rate), dec(100))
		)
			return yield* ctx.refuse('errors.percentage');
		const details =
			input.print_values !== undefined ? input.print_values : (old?.print_values ?? null);
		if (details && !validPrintValues(details))
			return yield* ctx.refuse('errors.print_values_invalid', { field: 'print_values' });
		const print_values = details ? orderedPrintValues(details) : null;
		const group = warehouses.rows.find((v) => v.id === order.warehouse)?.group_code;
		const floor = floors.rows
			.filter(
				(f) =>
					order.direction === 'sales' &&
					f.product === product.id &&
					f.currency === order.currency &&
					f.group_code === group &&
					f.effective_on <= order.ordered_on &&
					BigDecimal.isLessThanOrEqualTo(dec(f.minimum_quantity), dec(quantity))
			)
			.sort(
				(a, b) =>
					b.effective_on.localeCompare(a.effective_on) ||
					BigDecimal.Order(dec(b.minimum_quantity), dec(a.minimum_quantity))
			)[0];
		if (floor && floor.unit !== unit) return yield* ctx.refuse('errors.unit_mismatch');
		const floor_net = floor
			? floor.tax_inclusive
				? text(div(floor.floor_price, BigDecimal.sum(dec(1), div(floor.tax_rate, 100, 6)), 8))
				: floor.floor_price
			: null;
		const amounts = price(order, { quantity, unit_price, discount_pct, tax_rate });
		out.push({
			source_entry_id,
			quantity: text(quantity),
			unit_price: text(unit_price),
			discount_pct: text(discount_pct),
			tax_rate: text(tax_rate),
			...(input.print_values !== undefined ? { print_values } : {}),
			product_code: old?.product_code ?? product.external_code,
			product_name: old?.product_name ?? product.name,
			product_spec: old ? old.product_spec : product.spec,
			unit,
			currency: amounts.currency,
			net: text(amounts.net),
			tax: text(amounts.tax),
			total: text(amounts.total),
			floor_net,
			floor_on: floor?.effective_on ?? null,
			commission_basis_unit: old?.commission_basis_unit ?? product.commission_basis_unit,
			commission_factor: old?.commission_factor ?? product.commission_factor
		});
	}
	return out;
});
export default model({
	description: 'order lines',
	record_label: "record.order.number + ' · ' + record.product_name",
	fields: {
		order: { kind: 'ref', to: 'orders', inverse: 'lines', owned: true },
		line_key: { kind: 'text', optional: true, hidden: true },
		product: { kind: 'ref', to: 'products' },
		source_entry_id: { kind: 'text', optional: true, hidden: true },
		product_code: {
			kind: 'text'
		},
		product_name: {
			kind: 'text'
		},
		product_spec: { kind: 'text', optional: true },
		print_values: printValueKind,
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
	outputs: {
		default: {
			fields: 'all',
			product: { fields: ['name', 'external_code'] },
			order: { fields: ['number', 'ledger', 'direction'] }
		},
		logistics: {
			fields: logisticsLine,
			product: { fields: ['name', 'external_code'] },
			order: { fields: ['number', 'ledger', 'direction'] }
		}
	},
	constraints: {
		unit_price_nonnegative: {
			check: {
				unit_price: {
					gte: '0'
				}
			}
		},
		natural_key: { unique: ['order', 'line_key'], import_key: true }
	},
	indexes: { search: { text: ['product', 'product_code'] } },
	// a line created through its order's `'orders.lines'` layer runs this after the order's own `create.transform`
	create: {
		columns: {
			fields: ['order', 'line_key', 'product', ...cells, 'print_values', 'source_entry_id']
		},
		filled: { fields: ['unit_price', 'tax_rate'] },
		transform: function* (changes, ctx) {
			const derived = yield* priced(
				ctx,
				changes.map(({ after: row }) => ({
					order: row.order,
					product: row.product,
					cells: row,
					before: null,
					...(row.source_entry_id !== undefined ? { source_entry_id: row.source_entry_id } : {})
				}))
			);
			return changes.map(({ set }, i) => ({
				...set,
				line_key: set.line_key ?? crypto.randomUUID(),
				...derived[i]
			}));
		}
	},
	update: {
		columns: { fields: [...cells, 'print_values', 'source_entry_id'] },
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
	// a line delete is judged by its holders' policies (`lineDeletes` in `order-review.ts`)
	delete: {},
	syncs: {
		// The Kingdee SO's lines: the read mirrors each entry, a write sends the whole order.
		kingdee: {
			with: 'kingdee',
			every: '1min',
			read: function* ({ cursor, instance }, ctx) {
				return yield* readKingdeeOrderLines(instance, cursor, ctx);
			},
			write: function* ({ op, row, instance }, ctx) {
				const written = yield* pushOrder(row.order, instance, ctx);
				const entry = written?.lines.find((line) => line.line === row.id);
				return op === 'delete' || !written || !entry
					? null
					: { $id: `${written.$id}:${entry.entry}`, $version: entry.$version };
			}
		}
	}
});
