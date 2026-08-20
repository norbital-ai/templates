import { currencyFractionDigits, fromMinorUnits, toMinorUnits } from '@norbital-ai/std/finance';
import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { Hooks, WorkspaceRow } from './$types.js';

/**
 * The quotes and products this batch of lines refers to, read once for all of them.
 *
 * The rule below is written for one line and asks two questions about it: is its quote a draft, and
 * is its product active. Asked per line that is two round trips per row — a fifty-line quote pasted
 * in one call costs a hundred — and asked here it is two for the whole batch, whatever its size.
 *
 * `prepare` decides nothing. Every refusal and every derived amount still lives in `perRecord`,
 * once, which is what the deleted `batchHandler` could not promise: this collection carried the same
 * rule in both halves of `before`, and the batch copy was never called.
 */
interface QuoteLineBatch {
	readonly quotes: ReadonlyMap<string, WorkspaceRow<'quotes'>>;
	readonly products: ReadonlyMap<string, WorkspaceRow<'products'>>;
}

/**
 * `Hooks` with what `prepare` returns filled in.
 *
 * The generated `Hooks` alias fixes that parameter at `void`, so a collection that prepares anything
 * has to name the type itself. Once `bolt sync` emits `Hooks<Prepared = void>` this becomes
 * `satisfies Hooks<QuoteLineBatch>` and both lines go away.
 */
type QuoteLineHooks = CollectionHooks<WorkspaceSchema, 'quote_lines', QuoteLineBatch>;

function roundHalfUp(value: number, digits: number): number {
	if (!Number.isFinite(value)) {
		throw new Error('Cannot round a value that is not a finite number.');
	}
	const magnitude = Math.abs(shiftExponent(value, digits));
	const rounded = Math.round(magnitude);
	return shiftExponent(value < 0 ? -rounded : rounded, -digits);
}

function shiftExponent(value: number, places: number): number {
	if (value === 0) return 0;
	const [mantissa, exponent] = value.toExponential().split('e');
	return Number(`${mantissa}e${Number(exponent) + places}`);
}

interface LinePricing {
	readonly quantity: number;
	readonly unit_price: number;
	readonly discount_pct?: number | null;
	readonly tax_rate?: number | null;
	readonly tax_inclusive: boolean;
	readonly currency: string;
}

interface LineAmounts {
	readonly net: number;
	readonly tax: number;
	readonly gross: number;
}

function lineAmounts(line: LinePricing): LineAmounts {
	const digits = currencyFractionDigits(line.currency);
	const discount = line.discount_pct ?? 0;
	const rate = (line.tax_rate ?? 0) / 100;
	const base = line.quantity * line.unit_price * (1 - discount / 100);

	if (line.tax_inclusive) {
		const gross = roundHalfUp(base, digits);
		const net = roundHalfUp(gross / (1 + rate), digits);
		return { net, tax: roundHalfUp(gross - net, digits), gross };
	}

	const net = roundHalfUp(base, digits);
	const tax = roundHalfUp(net * rate, digits);
	return { net, tax, gross: roundHalfUp(net + tax, digits) };
}

function documentTotals(lines: readonly LineAmounts[], currency: string): LineAmounts {
	let net = 0n;
	let tax = 0n;
	let gross = 0n;
	for (const line of lines) {
		net += toMinorUnits(line.net, currency);
		tax += toMinorUnits(line.tax, currency);
		gross += toMinorUnits(line.gross, currency);
	}
	return {
		net: fromMinorUnits(net, currency),
		tax: fromMinorUnits(tax, currency),
		gross: fromMinorUnits(gross, currency)
	};
}

type AfterApi = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['after']>['handler']
>[0]['api'];
type CreateInput = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['create']>['perRecord']>['before']>['handler']
>[0]['input'];
type UpdateInput = Parameters<
	NonNullable<NonNullable<NonNullable<Hooks['update']>['perRecord']>['before']>['handler']
>[0]['input'];

const LINE_LIMIT = 5000;

function requireCurrency(currency: string | null): string {
	if (!currency) throw new Error('Document currency is required.');
	return currency;
}

function validateLineFields(input: {
	readonly quantity: number;
	readonly unit_price: number;
	readonly discount_pct?: number | null;
	readonly tax_rate?: number | null;
}): void {
	if (Number.isNaN(input.quantity) || input.quantity <= 0) {
		throw new Error('Quantity must be greater than zero.');
	}
	if (Number.isNaN(input.unit_price) || input.unit_price < 0) {
		throw new Error('Unit price cannot be negative.');
	}
	const discountPct = Number(input.discount_pct ?? 0);
	if (discountPct < 0 || discountPct > 100) {
		throw new Error('Discount percentage must be between 0 and 100.');
	}
	const taxRate = Number(input.tax_rate ?? 0);
	if (taxRate < 0 || taxRate > 100) {
		throw new Error('Tax rate must be between 0 and 100.');
	}
}

function computeLineAmounts(
	quote: WorkspaceRow<'quotes'>,
	line: CreateInput | WorkspaceRow<'quote_lines'>
): LineAmounts {
	return lineAmounts({
		quantity: Number(line.quantity),
		unit_price: Number(line.unit_price),
		discount_pct: Number(line.discount_pct ?? 0),
		tax_rate: Number(line.tax_rate ?? 0),
		tax_inclusive: quote.tax_inclusive,
		currency: requireCurrency(quote.currency)
	});
}

function rollupQuote(api: AfterApi, quoteId: string): Effect.Effect<void> {
	return Effect.gen(function* () {
		const quote = yield* api.db.query.quotes.findFirst({
			where: { norbital_id: { eq: quoteId } }
		});
		if (!quote) return;

		const lines = yield* api.db.query.quote_lines.findMany({
			where: { quote_id: { eq: quoteId } },
			columns: { net: true, tax: true, line_total: true },
			limit: LINE_LIMIT
		});

		const totals = documentTotals(
			lines.map((line) => ({
				net: Number(line.net ?? 0),
				tax: Number(line.tax ?? 0),
				gross: Number(line.line_total ?? 0)
			})),
			requireCurrency(quote.currency)
		);

		yield* api.db.quotes.mutate([
			{
				norbital_id: quoteId,
				net: totals.net,
				tax: totals.tax,
				gross: totals.gross
			}
		]);
	});
}

const afterRollup = ({
	record,
	api
}: {
	readonly record: { readonly quote_id: string };
	readonly api: AfterApi;
}) =>
	Effect.gen(function* () {
		yield* rollupQuote(api, record.quote_id);
	});

export default {
	create: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const quoteIds = [
					...new Set(inputs.flatMap((input) => (input.quote_id ? [input.quote_id] : [])))
				];
				const productIds = [
					...new Set(inputs.flatMap((input) => (input.product_id ? [input.product_id] : [])))
				];
				const quotes = quoteIds.length
					? yield* api.db.query.quotes.findMany({
							where: { norbital_id: { in: quoteIds } },
							limit: LINE_LIMIT
						})
					: [];
				const products = productIds.length
					? yield* api.db.query.products.findMany({
							where: { norbital_id: { in: productIds } },
							limit: LINE_LIMIT
						})
					: [];
				return {
					quotes: new Map(quotes.map((quote) => [quote.norbital_id, quote])),
					products: new Map(products.map((product) => [product.norbital_id, product]))
				};
			}),
		perRecord: {
			before: {
				description:
					'Adds a line only to a draft quote for an active product, fills the product code, name, unit and tax rate from the catalogue, and computes the line net, tax and total from quantity, unit price and discount.',
				handler: ({ input, prepared }) => {
					if (!input.quote_id) throw new Error('A quote line must reference a quote.');
					const quote = prepared.quotes.get(input.quote_id);
					if (!quote) throw new Error('Referenced quote does not exist.');
					if (quote.status !== 'draft') {
						throw new Error('Line items can only be added to draft quotes.');
					}

					if (!input.product_id) throw new Error('A quote line must reference a product.');
					const product = prepared.products.get(input.product_id);
					if (!product) throw new Error('Referenced product does not exist.');
					if (!product.active) {
						throw new Error('Cannot add a line for an inactive product.');
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
					validateLineFields(resolved);

					const amounts = computeLineAmounts(quote, resolved);

					return {
						...resolved,
						net: amounts.net,
						tax: amounts.tax,
						line_total: amounts.gross
					};
				}
			},
			after: {
				description:
					'Recomputes the quote net, tax and gross from its lines after a line is added.',
				handler: afterRollup
			}
		}
	},
	update: {
		perRecord: {
			before: {
				description:
					'Keeps a line on its own draft quote and recomputes its net, tax and total from the changed quantity, unit price or discount.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						if (input.quote_id != null && input.quote_id !== existing.quote_id) {
							throw new Error('A line item cannot be moved to a different quote.');
						}

						const quote = yield* api.db.query.quotes.findFirst({
							where: { norbital_id: { eq: existing.quote_id } }
						});
						if (!quote) throw new Error('Referenced quote does not exist.');
						if (quote.status !== 'draft') {
							throw new Error('Line items can only be modified on draft quotes.');
						}

						const resolved = { ...existing, ...input };
						validateLineFields(resolved);

						const amounts = computeLineAmounts(quote, resolved);

						return {
							...input,
							net: amounts.net,
							tax: amounts.tax,
							line_total: amounts.gross
						} satisfies UpdateInput;
					})
			},
			after: {
				description:
					'Recomputes the quote net, tax and gross from its lines after a line is changed.',
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
} satisfies QuoteLineHooks;
