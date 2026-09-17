import { defineCollection, refuse, type CollectionInputOf } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceRow } from '$bolt/types.js';
import { batchEntries, uniqueIds } from '../../lib/lifecycle.js';
import { documentLineAmounts, validateLineCells } from '../../lib/pricing.js';
import model from './+model.js';

/** The pricing cells a rep states; code, name, unit and the money columns are derived. */
const cells = { quantity: true, unit_price: true, discount_pct: true, tax_rate: true } as const;

const create = { input: { columns: { quote_id: true, product_id: true, ...cells } } } as const;
/** A line stays on its quote and its product; only its pricing cells move. */
const update = { input: { columns: cells } } as const;

type Create = CollectionInputOf<typeof model, typeof create, 'create'>;
type Update = CollectionInputOf<typeof model, typeof update, 'update'>;
type Stored = WorkspaceRow<'quote_lines'>;

const LIMIT = 5000;

/**
 * Adds a line only to a draft quote for an active product, fills the product code, name, unit
 * and tax rate from the catalogue, and computes the line net, tax and total from quantity, unit
 * price and discount. Keeps a line on its own draft quote and recomputes its amounts from the
 * changed cells. The quote's own totals follow through the roll-up automations.
 */
export default defineCollection({
	model,
	create,
	update,
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const entries = batchEntries<Create, Update, Stored>(inputs, existing);
			const quoteIds = uniqueIds(
				entries.map((entry) =>
					entry.kind === 'create' ? entry.input.quote_id : entry.stored.quote_id
				)
			);
			const productIds = uniqueIds(
				entries.flatMap((entry) => (entry.kind === 'create' ? [entry.input.product_id] : []))
			);
			const [quotes, products] = yield* Effect.all(
				[
					db.quotes.findMany({ where: { id: { in: quoteIds } }, limit: LIMIT }),
					productIds.length
						? db.products.findMany({ where: { id: { in: productIds } }, limit: LIMIT })
						: Effect.succeed([])
				],
				{ concurrency: 'unbounded' }
			);
			const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
			const productById = new Map(products.map((product) => [product.id, product]));

			return entries.map((entry) => {
				if (entry.kind === 'create') {
					const { input } = entry;
					const quote = quoteById.get(input.quote_id);
					if (!quote) refuse('Referenced quote does not exist.');
					if (quote.status !== 'draft') refuse('Line items can only be added to draft quotes.');
					const product = productById.get(input.product_id);
					if (!product) refuse('Referenced product does not exist.');
					if (!product.active) refuse('Cannot add a line for an inactive product.');
					const resolved = {
						...input,
						discount_pct: input.discount_pct ?? 0,
						tax_rate: input.tax_rate ?? product.tax_rate ?? 0,
						product_code: product.code,
						product_name: product.name,
						product_unit: product.unit ?? ''
					};
					validateLineCells(resolved);
					const amounts = documentLineAmounts(quote, resolved);
					return { ...resolved, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
				}
				const { input, stored } = entry;
				const quote = quoteById.get(stored.quote_id);
				if (!quote) refuse('Referenced quote does not exist.');
				if (quote.status !== 'draft') refuse('Line items can only be modified on draft quotes.');
				const resolved = { ...stored, ...input };
				validateLineCells(resolved);
				const amounts = documentLineAmounts(quote, resolved);
				return { ...input, net: amounts.net, tax: amounts.tax, line_total: amounts.gross };
			});
		})
});
