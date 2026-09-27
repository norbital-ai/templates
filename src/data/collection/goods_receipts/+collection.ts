import { collection, type TransformCtx } from '@norbital-ai/bolt';

/**
 * Accepts a receipt only against a confirmed purchase order (numbered `GRN-<year>-<n>`; received today unless stated).
 * A receipt is an event: written once, never edited.
 */
const c = collection('goods_receipts', {
	read: { fields: 'all' },
	create: { input: { columns: ['purchase_order_id', 'owner_id', 'received_date', 'note'] } }
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'goods_receipts'>) => {
	const orders = await ctx.db.read('purchase_orders', {
		where: { id: { in: inputs.map((input) => input.purchase_order_id!) } },
		all: true
	});
	return inputs.map((input) => {
		const order = orders.rows.find((o) => o.id === input.purchase_order_id);
		if (!order) ctx.refuse('Referenced purchase order does not exist.');
		if (order.status !== 'confirmed')
			ctx.refuse('Goods can only be received against a confirmed purchase order.');
		return input;
	});
});
