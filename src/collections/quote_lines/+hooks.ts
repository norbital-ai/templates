import {
	refuse,
	type MutateAfterContext,
	type MutateBeforeContext,
	type MutateEditContext,
	type MutatePrepareContext
} from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import { rowsById } from '../../lib/batch-reads.js';
import { rollupDocument } from '../../lib/document-lines.js';
import { documentLineAmounts, type LinePricing } from '../../lib/pricing.js';
import type { Hooks, WorkspaceRow } from './$types.js';

/**
 * The quotes and products this batch of lines refers to, read once for all of them.
 *
 * The rule below is written for one line and asks two questions about it: is its quote a draft, and
 * is its product active. Asked per line that is two round trips per row — a fifty-line quote pasted
 * in one call costs a hundred — and asked here it is two for the whole batch, whatever its size.
 *
 * `prepare` decides nothing. Every refusal and every derived amount still lives in `perRecord`,
 * once, for one line.
 */
interface QuoteLineBatch {
	readonly quotes: ReadonlyMap<string, WorkspaceRow<'quotes'>>;
	readonly products: ReadonlyMap<string, WorkspaceRow<'products'>>;
}

type AfterApi = MutateAfterContext<Hooks<QuoteLineBatch>>['api'];
type UpdateInput = MutateBeforeContext<Hooks<QuoteLineBatch>>['input'];

type PrepareApi = MutatePrepareContext<Hooks<QuoteLineBatch>>['api'];

const LINE_LIMIT = 5000;

/** The quotes a batch of lines is being added to. */
const quotesByIds = (api: PrepareApi) => (ids: readonly string[]) =>
	api.db.quotes.findMany({ where: { id: { in: ids } }, limit: LINE_LIMIT });

/** The catalogue products a batch of lines names. */
const productsByIds = (api: PrepareApi) => (ids: readonly string[]) =>
	api.db.products.findMany({ where: { id: { in: ids } }, limit: LINE_LIMIT });

/** The line fields validation asks about, from the row's own fields. */
type LineFieldValues = Partial<
	Pick<WorkspaceRow<'quote_lines'>, 'quantity' | 'unit_price' | 'discount_pct' | 'tax_rate'>
>;

/** A line's pricing cells once validated — the one coercion, shared by the checks and the pricing. */
type LinePricingCells = Pick<LinePricing, 'quantity' | 'unit_price' | 'discount_pct' | 'tax_rate'>;

function validateLineFields(input: LineFieldValues): LinePricingCells {
	const quantity = decodeNumber(input.quantity);
	if (Number.isNaN(quantity) || quantity <= 0) {
		refuse('Quantity must be greater than zero.');
	}
	const unitPrice = decodeNumber(input.unit_price);
	if (Number.isNaN(unitPrice) || unitPrice < 0) {
		refuse('Unit price cannot be negative.');
	}
	const discountPct = decodeNumber(input.discount_pct ?? 0);
	if (discountPct < 0 || discountPct > 100) {
		refuse('Discount percentage must be between 0 and 100.');
	}
	const taxRate = decodeNumber(input.tax_rate ?? 0);
	if (taxRate < 0 || taxRate > 100) {
		refuse('Tax rate must be between 0 and 100.');
	}
	return { quantity, unit_price: unitPrice, discount_pct: discountPct, tax_rate: taxRate };
}

/** The quote a roll-up writes back to. */
const quoteById = (api: AfterApi, quoteId: string) =>
	api.db.quotes.findFirst({ where: { id: { eq: quoteId } } });

/** The money cells of every line on one quote. */
const quoteLineTotals = (api: AfterApi, quoteId: string) =>
	api.db.quote_lines.findMany({
		where: { quote_id: { eq: quoteId } },
		columns: { net: true, tax: true, line_total: true },
		limit: LINE_LIMIT
	});

function rollupQuote(api: AfterApi, quoteId: string): Effect.Effect<void> {
	return rollupDocument({
		document: quoteById(api, quoteId),
		lines: quoteLineTotals(api, quoteId),
		write: (totals) => api.db.quotes.mutate([{ id: quoteId, ...totals }])
	});
}

const afterRollup = ({
	record,
	api
}: {
	readonly record: { readonly quote_id: string };
	readonly api: AfterApi;
}) => rollupQuote(api, record.quote_id);

type BeforeContext = MutateBeforeContext<Hooks<QuoteLineBatch>>;
type EditContext = MutateEditContext<Hooks<QuoteLineBatch>>;

/** A create states the whole record and has no `existing`. */
const beforeCreate = ({ input, prepared }: BeforeContext) => {
	if (!input.quote_id) refuse('A quote line must reference a quote.');
	const quote = prepared.quotes.get(input.quote_id);
	if (!quote) refuse('Referenced quote does not exist.');
	if (quote.status !== 'draft') {
		refuse('Line items can only be added to draft quotes.');
	}

	if (!input.product_id) refuse('A quote line must reference a product.');
	const product = prepared.products.get(input.product_id);
	if (!product) refuse('Referenced product does not exist.');
	if (!product.active) {
		refuse('Cannot add a line for an inactive product.');
	}

	const resolved = {
		...input,
		quantity: input.quantity,
		unit_price: input.unit_price ?? product.unit_price ?? 0,
		discount_pct: input.discount_pct ?? 0,
		tax_rate: input.tax_rate ?? product.tax_rate ?? 0,
		product_code: input.product_code ?? product.code,
		product_name: input.product_name ?? product.name,
		product_unit: input.product_unit ?? product.unit ?? ''
	};
	const lineCells = validateLineFields(resolved);

	const amounts = documentLineAmounts(quote, lineCells);

	return {
		...resolved,
		net: amounts.net,
		tax: amounts.tax,
		line_total: amounts.gross
	};
};

/** An edit lands on a stored row; `existing` is what tells the two apart. */
const beforeUpdate = ({ input, existing, api }: EditContext) => {
	if (input.quote_id != null && input.quote_id !== existing.quote_id) {
		refuse('A line item cannot be moved to a different quote.');
	}

	return Effect.map(
		api.db.quotes.findFirst({ where: { id: { eq: existing.quote_id } } }),
		(quote) => {
			if (!quote) refuse('Referenced quote does not exist.');
			if (quote.status !== 'draft') {
				refuse('Line items can only be modified on draft quotes.');
			}

			const resolved = { ...existing, ...input };
			const lineCells = validateLineFields(resolved);

			const amounts = documentLineAmounts(quote, lineCells);

			return {
				...input,
				net: amounts.net,
				tax: amounts.tax,
				line_total: amounts.gross
			} satisfies UpdateInput;
		}
	);
};

export default {
	mutate: {
		prepare: ({ inputs, api }) =>
			Effect.all({
				quotes: rowsById(inputs, (input) => input.quote_id, quotesByIds(api)),
				products: rowsById(inputs, (input) => input.product_id, productsByIds(api))
			}),
		perRecord: {
			before: {
				description:
					'Adds a line only to a draft quote for an active product, fills the product code, name, unit and tax rate from the catalogue, and computes the line net, tax and total from quantity, unit price and discount. Keeps a line on its own draft quote and recomputes its net, tax and total from the changed quantity, unit price or discount.',
				handler: (context) =>
					context.existing === undefined
						? beforeCreate(context)
						: beforeUpdate({ ...context, existing: context.existing })
			},
			after: {
				description:
					'Recomputes the quote net, tax and gross from its lines after a line is added. Recomputes the quote net, tax and gross from its lines after a line is changed.',
				handler: afterRollup
			}
		}
	},
	delete: {
		perRecord: {
			after: {
				description:
					'Recomputes the quote net, tax and gross from its lines after a line is removed.',
				handler: afterRollup
			}
		}
	}
} satisfies Hooks<QuoteLineBatch>;
