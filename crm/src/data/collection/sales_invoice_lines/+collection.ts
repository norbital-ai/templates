import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { ledger, num, priceLine } from '../../../lib/pricing.js';

/**
 * Bills a quote line of the invoice's own quote (only while the invoice is a draft: the line is owned), snapshotting
 * the product, price, discount and tax rate, and refuses to bill more than was quoted, counting only lines on invoices
 * that are not cancelled. An update re-prices from the changed cells. The invoice's totals are its roll-ups.
 */
const c = collection('sales_invoice_lines', {
	read: { fields: 'all' },
	create: { input: { columns: ['sales_invoice_id', 'quote_line_id', 'quantity'] } },
	update: { input: { columns: ['quantity', 'unit_price', 'tax_rate'] } },
	delete: {}
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'sales_invoice_lines'>) => {
	const invoiceIds = inputs.map(
		(input, i) => input.sales_invoice_id ?? ctx.existing[i]!.sales_invoice_id
	);
	const quoteLineIds = inputs.map(
		(input, i) => input.quote_line_id ?? ctx.existing[i]!.quote_line_id
	);
	const [invoices, quoteLines, billed] = await Promise.all([
		ctx.db.read('sales_invoices', { where: { id: { in: invoiceIds } }, all: true }),
		ctx.db.read('quote_lines', { where: { id: { in: quoteLineIds } }, all: true }),
		// what is already billed against these quote lines: a cancelled invoice bills nothing
		ctx.db.read('sales_invoice_lines', {
			where: {
				quote_line_id: { in: quoteLineIds },
				sales_invoice_id: { is: { status: { ne: 'cancelled' } } }
			},
			all: true
		})
	]);
	// a line this batch re-states is claimed at its new quantity, not its stored one
	const restated = new Set(ctx.existing.flatMap((row) => row?.id ?? []));
	const claim = ledger(
		billed.rows
			.filter((l) => !restated.has(l.id))
			.map((l) => [l.quote_line_id, num(l.quantity)] as const)
	);

	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		const invoice = invoices.rows.find((row) => row.id === invoiceIds[i]);
		if (!invoice) ctx.refuse('Referenced sales invoice does not exist.');
		const quoteLine = quoteLines.rows.find((row) => row.id === quoteLineIds[i]);
		if (!quoteLine) ctx.refuse('Referenced quote line does not exist.');
		if (stored === undefined && quoteLine.quote_id !== invoice.quote_id)
			ctx.refuse('The billed line belongs to a different quote.');
		const written =
			stored !== undefined
				? input
				: {
						...input,
						product_code: quoteLine.product_code,
						product_name: quoteLine.product_name,
						product_unit: quoteLine.product_unit ?? '',
						unit_price: quoteLine.unit_price,
						discount_pct: quoteLine.discount_pct,
						tax_rate: quoteLine.tax_rate
					};
		const line = { ...stored, ...written };
		const priced = priceLine(invoice, line);
		if ('refusal' in priced) ctx.refuse(priced.refusal);
		const over = claim(
			quoteLine.id,
			num(line.quantity),
			num(quoteLine.quantity),
			(soFar, quoted) =>
				stored === undefined
					? `Over-allocation: ${soFar} of ${quoted} billed so far; this line would exceed the quoted quantity.`
					: `Over-allocation: this line would push billed quantity past the quoted ${quoted}.`
		);
		if (over !== null) ctx.refuse(over);
		return { ...written, ...priced };
	});
});
