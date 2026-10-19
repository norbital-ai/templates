import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { d, price } from '../../../lib/commercial.js';
const cells = ['quantity', 'unit_price', 'discount_pct', 'tax_rate'] as const;
const c = collection('order_lines', {
	read: { fields: 'all' },
	create: {
		input: { columns: ['order', 'product', ...cells], filled: ['unit_price', 'tax_rate'] }
	},
	update: { input: { columns: cells } },
	delete: {}
});
export default c;
c.transform(function* (inputs, ctx: TransformCtx<'order_lines'>) {
	const { products, floors, warehouses } = yield* ctx.db.read({
		products: {
			collection: 'products',
			where: { id: { in: inputs.map((v, i) => v.product ?? ctx.existing[i]!.product) } },
			all: true
		},
		floors: {
			collection: 'pricing_floors',
			where: { product: { in: inputs.map((v, i) => v.product ?? ctx.existing[i]!.product) } },
			all: true
		},
		warehouses: { collection: 'warehouses', where: {}, all: true }
	});
	const orders = yield* ctx.db.after('orders', {
		id: { in: inputs.map((v, i) => v.order ?? ctx.existing[i]!.order) }
	});
	const out = [];
	for (const [i, input] of inputs.entries()) {
		const old = ctx.existing[i];
		const order = orders.find((o) => o.id === (input.order ?? old?.order));
		const product = products.rows.find((p) => p.id === (input.product ?? old?.product));
		if (!order || order.status !== 'draft') return yield* ctx.refuse('errors.order_sealed');
		if (!product?.active) return yield* ctx.refuse('errors.product_inactive');
		if (product.source !== order.ledger)
			return yield* ctx.refuse('errors.ledger_mismatch', { field: 'product' });
		if (order.currency !== product.currency && input.unit_price === undefined && !old)
			return yield* ctx.refuse('errors.currency_price');
		const quantity = input.quantity ?? old?.quantity;
		const unit_price =
			input.unit_price ??
			old?.unit_price ??
			(order.direction === 'sales' ? product.unit_price : null);
		const discount_pct = input.discount_pct ?? old?.discount_pct ?? d(0);
		const tax_rate = input.tax_rate ?? old?.tax_rate ?? product.tax_rate;
		if (quantity === undefined || d(quantity).lte(0))
			return yield* ctx.refuse('errors.quantity_positive', { field: 'quantity' });
		if (unit_price === null || unit_price === undefined || d(unit_price).lt(0))
			return yield* ctx.refuse('errors.price_required', { field: 'unit_price' });
		if (
			d(discount_pct).lt(0) ||
			d(discount_pct).gt(100) ||
			d(tax_rate).lt(0) ||
			d(tax_rate).gt(100)
		)
			return yield* ctx.refuse('errors.percentage');
		const group = warehouses.rows.find((v) => v.id === order.warehouse)?.group_code;
		const floor = floors.rows
			.filter(
				(f) =>
					f.product === product.id &&
					f.currency === order.currency &&
					f.group_code === group &&
					f.effective_on <= order.ordered_on &&
					d(f.minimum_quantity).lte(quantity)
			)
			.sort(
				(a, b) =>
					b.effective_on.localeCompare(a.effective_on) ||
					d(b.minimum_quantity).cmp(a.minimum_quantity)
			)[0];
		if (floor && floor.unit !== product.unit) return yield* ctx.refuse('errors.unit_mismatch');
		const floor_net = floor
			? floor.tax_inclusive
				? d(floor.floor_price).div(d(1).plus(d(floor.tax_rate).div(100, 6)), 8)
				: floor.floor_price
			: null;
		out.push({
			...input,
			quantity,
			unit_price,
			discount_pct,
			tax_rate,
			product_code: old?.product_code ?? product.external_code,
			product_name: old?.product_name ?? product.name,
			unit: old?.unit ?? product.unit,
			...price(order, { quantity, unit_price, discount_pct, tax_rate }),
			floor_net,
			floor_on: floor?.effective_on ?? null,
			commission_basis_unit: old?.commission_basis_unit ?? product.commission_basis_unit,
			commission_factor: old?.commission_factor ?? product.commission_factor
		});
	}
	return out;
});
