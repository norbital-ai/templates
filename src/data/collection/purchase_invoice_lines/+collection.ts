import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { ledger, num, priceLine } from '../../../lib/pricing.js';

/**
 * Matches an invoice line to an order line of the invoice's own order (only while the invoice is a draft: the line is
 * owned), snapshotting the product and cost, and refuses to invoice more than was ordered, counting only lines on
 * invoices that are not cancelled. An update re-prices from the changed cells.
 */
const c = collection('purchase_invoice_lines', {
	read: { fields: 'all' },
	create: {
		input: { columns: ['purchase_invoice_id', 'purchase_order_line_id', 'quantity', 'tax_rate'] }
	},
	update: { input: { columns: ['quantity', 'unit_cost', 'tax_rate'] } },
	delete: {}
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'purchase_invoice_lines'>) => {
	const invoiceIds = inputs.map(
		(input, i) => input.purchase_invoice_id ?? ctx.existing[i]!.purchase_invoice_id
	);
	const orderLineIds = inputs.map(
		(input, i) => input.purchase_order_line_id ?? ctx.existing[i]!.purchase_order_line_id
	);
	const [invoices, orderLines, invoiced] = await Promise.all([
		ctx.db.read('purchase_invoices', { where: { id: { in: invoiceIds } }, all: true }),
		ctx.db.read('purchase_order_lines', { where: { id: { in: orderLineIds } }, all: true }),
		// what is already invoiced against these order lines: a cancelled invoice claims nothing
		ctx.db.read('purchase_invoice_lines', {
			where: {
				purchase_order_line_id: { in: orderLineIds },
				purchase_invoice_id: { is: { status: { ne: 'cancelled' } } }
			},
			all: true
		})
	]);
	const restated = new Set(ctx.existing.flatMap((row) => row?.id ?? []));
	const claim = ledger(
		invoiced.rows
			.filter((l) => !restated.has(l.id))
			.map((l) => [l.purchase_order_line_id, num(l.quantity)] as const)
	);

	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		const invoice = invoices.rows.find((row) => row.id === invoiceIds[i]);
		if (!invoice) ctx.refuse('Referenced purchase invoice does not exist.');
		const orderLine = orderLines.rows.find((row) => row.id === orderLineIds[i]);
		if (!orderLine) ctx.refuse('Referenced purchase order line does not exist.');
		if (stored === undefined && orderLine.purchase_order_id !== invoice.purchase_order_id)
			ctx.refuse('The invoiced line belongs to a different purchase order.');
		const written =
			stored !== undefined
				? input
				: {
						...input,
						product_code: orderLine.product_code,
						product_name: orderLine.product_name,
						unit_cost: orderLine.unit_cost,
						tax_rate: input.tax_rate ?? orderLine.tax_rate
					};
		const line = { ...stored, ...written };
		const priced = priceLine(invoice, { ...line, unit_price: line.unit_cost }, 'Unit cost');
		if ('refusal' in priced) ctx.refuse(priced.refusal);
		const over = claim(
			orderLine.id,
			num(line.quantity),
			num(orderLine.quantity),
			(soFar, ordered) =>
				stored === undefined
					? `Over-invoice: ${soFar} of ${ordered} invoiced so far; this line would exceed the ordered quantity.`
					: `Over-invoice: this line would push invoiced quantity past the ordered ${ordered}.`
		);
		if (over !== null) ctx.refuse(over);
		return { ...written, ...priced };
	});
});
