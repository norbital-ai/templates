import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { dec, priceLine } from '../../../lib/pricing.js';

/** The buy-side cells the purchaser states; code, name, unit and the money columns are derived. */
const cells = ['quantity', 'unit_cost', 'tax_rate'] as const;

/**
 * Adds a line for an active product (only while its order is a draft: the line is owned), fills the product code,
 * name, unit and tax rate from the catalogue, and prices it from quantity and unit cost. The order's totals are its
 * roll-ups; `received` sums the goods receipts against the line.
 */
const c = collection('purchase_order_lines', {
	read: { fields: 'all' },
	create: { input: { columns: ['purchase_order_id', 'product_id', ...cells] } },
	update: { input: { columns: cells } },
	delete: {}
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'purchase_order_lines'>) => {
	const orderIds = inputs.map(
		(input, i) => input.purchase_order_id ?? ctx.existing[i]!.purchase_order_id
	);
	const [orders, products] = await Promise.all([
		ctx.db.read('purchase_orders', { where: { id: { in: orderIds } }, all: true }),
		ctx.db.read('products', {
			where: { id: { in: inputs.flatMap((input) => input.product_id ?? []) } },
			all: true
		})
	]);
	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		const order = orders.rows.find((o) => o.id === orderIds[i]);
		if (!order) ctx.refuse('Referenced purchase order does not exist.');
		const product = products.rows.find((p) => p.id === input.product_id);
		if (stored === undefined && !product) ctx.refuse('Referenced product does not exist.');
		if (product?.active === false) ctx.refuse('Cannot add a line for an inactive product.');
		const written =
			product === undefined
				? input
				: {
						...input,
						tax_rate: input.tax_rate ?? product.tax_rate ?? dec(0),
						product_code: product.code,
						product_name: product.name,
						product_unit: product.unit ?? ''
					};
		const cells = { ...stored, ...written };
		const priced = priceLine(order, { ...cells, unit_price: cells.unit_cost }, 'Unit cost');
		if ('refusal' in priced) ctx.refuse(priced.refusal);
		return { ...written, ...priced };
	});
});
