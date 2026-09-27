import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { ledger, num } from '../../../lib/pricing.js';

/**
 * Ties a received quantity to an order line of the receipt's own order and refuses a delivery that would take the
 * cumulative received quantity (what is on file, plus this batch; the order line's `received` roll-up
 * and its `check` hold the same bound in the statement) past the quantity ordered.
 * Written once, never edited.
 */
const c = collection('goods_receipt_lines', {
	read: { fields: 'all' },
	create: {
		input: { columns: ['goods_receipt_id', 'purchase_order_line_id', 'quantity_received'] }
	}
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'goods_receipt_lines'>) => {
	const orderLineIds = inputs.map((input) => input.purchase_order_line_id!);
	const [receipts, orderLines, prior] = await Promise.all([
		ctx.db.read('goods_receipts', {
			where: { id: { in: inputs.map((input) => input.goods_receipt_id!) } },
			all: true
		}),
		ctx.db.read('purchase_order_lines', { where: { id: { in: orderLineIds } }, all: true }),
		ctx.db.read('goods_receipt_lines', {
			where: { purchase_order_line_id: { in: orderLineIds } },
			all: true
		})
	]);
	const claim = ledger(
		prior.rows.map((l) => [l.purchase_order_line_id, num(l.quantity_received)] as const)
	);
	return inputs.map((input) => {
		const receipt = receipts.rows.find((r) => r.id === input.goods_receipt_id);
		if (!receipt) ctx.refuse('Referenced goods receipt does not exist.');
		const orderLine = orderLines.rows.find((l) => l.id === input.purchase_order_line_id);
		if (!orderLine) ctx.refuse('Referenced purchase order line does not exist.');
		if (orderLine.purchase_order_id !== receipt.purchase_order_id)
			ctx.refuse('The received line belongs to a different purchase order.');
		const quantity = num(input.quantity_received);
		if (!(quantity > 0)) ctx.refuse('Received quantity must be greater than zero.');
		const over = claim(
			orderLine.id,
			quantity,
			num(orderLine.quantity),
			(soFar, ordered) =>
				`Over-delivery: ${soFar} of ${ordered} received so far; this receipt would exceed the ordered quantity.`
		);
		if (over !== null) ctx.refuse(over);
		return input;
	});
});
