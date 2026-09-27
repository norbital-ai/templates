import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { dec, priceLine } from '../../../lib/pricing.js';

/** The pricing cells a rep states; code, name, unit and the money columns are derived. */
const cells = ['quantity', 'unit_price', 'discount_pct', 'tax_rate'] as const;

/**
 * Adds a line for an active product (only while its quote is a draft: the line is owned), fills the product code,
 * name, unit and tax rate from the catalogue, and prices net, tax and total against the quote. An update re-prices
 * from the changed cells; a line never moves to another quote or product. The quote's totals are its roll-ups.
 */
const c = collection('quote_lines', {
	read: { fields: 'all' },
	create: { input: { columns: ['quote_id', 'product_id', ...cells] } },
	update: { input: { columns: cells } },
	delete: {}
});
export default c;

c.transform(async (inputs, ctx: TransformCtx<'quote_lines'>) => {
	const quoteIds = inputs.map((input, i) => input.quote_id ?? ctx.existing[i]!.quote_id);
	const [quotes, products] = await Promise.all([
		ctx.db.read('quotes', { where: { id: { in: quoteIds } }, all: true }),
		ctx.db.read('products', {
			where: { id: { in: inputs.flatMap((input) => input.product_id ?? []) } },
			all: true
		})
	]);
	return inputs.map((input, i) => {
		const stored = ctx.existing[i];
		const quote = quotes.rows.find((q) => q.id === quoteIds[i]);
		if (!quote) ctx.refuse('Referenced quote does not exist.');
		const product = products.rows.find((p) => p.id === input.product_id);
		if (stored === undefined && !product) ctx.refuse('Referenced product does not exist.');
		if (product?.active === false) ctx.refuse('Cannot add a line for an inactive product.');
		// a new line snapshots the product; an update re-prices from the stored cells and the changed ones
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
		const priced = priceLine(quote, { ...stored, ...written });
		if ('refusal' in priced) ctx.refuse(priced.refusal);
		return { ...written, ...priced };
	});
});
