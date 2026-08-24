import { Effect, Schema } from 'effect';
import type { Pipelines } from './$types.js';

/**
 * The JSON attachment body of one confirmed quote export.
 *
 * The host hands the attachment to the binding's `transform` for the outbound request, so its shape
 * is the wire contract: schema name, the header facts as they were confirmed, and the lines in the
 * quote's own currency. The schema owns the keys and types once; the export below only projects the
 * row into it.
 */
const quoteExportSchema = Schema.Struct({
	schema: Schema.Literal('norbital.crm.confirmed_quote.v1'),
	quote: Schema.Struct({
		doc_no: Schema.String,
		title: Schema.String,
		status: Schema.NullOr(
			Schema.Literals(['draft', 'sent', 'won', 'confirmed', 'lost', 'cancelled'])
		),
		currency: Schema.NullOr(Schema.Literals(['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD'])),
		net: Schema.NullOr(Schema.Number),
		tax: Schema.NullOr(Schema.Number),
		gross: Schema.NullOr(Schema.Number),
		confirmed_at: Schema.NullOr(Schema.Date)
	}),
	lines: Schema.Array(
		Schema.Struct({
			product_code: Schema.String,
			product_name: Schema.String,
			quantity: Schema.Number,
			unit_price: Schema.NullOr(Schema.Number),
			discount_pct: Schema.NullOr(Schema.Number),
			tax_rate: Schema.NullOr(Schema.Number),
			line_total: Schema.NullOr(Schema.Number)
		})
	)
});

/** Built once, beside its schema: a decoder rebuilt per exported record is per-record work.*/
const decodeQuoteExport = Schema.decodeUnknownEffect(quoteExportSchema);

/**
 * The push payload the outbound integration binding delivers.
 *
 * The host runs this export against the outboxed records — a confirmed quote and its lines — and
 * the binding's `transform` takes the JSON attachment as the request body. The schema above is the
 * handoff contract: document number, header facts, and the lines exactly as they were confirmed.
 */
export default {
	export: {
		description:
			'Packages each confirmed quote with its lines as a JSON attachment for the downstream system to receive.',
		handler: ({ records }, api) =>
			Effect.gen(function* () {
				const quoteIds = records.map((quote) => quote.id);
				if (quoteIds.length === 0) return [];

				const lines = yield* api.db.query.quote_lines.findMany({
					where: { quote_id: { in: quoteIds } },
					limit: 5000
				});

				return yield* Effect.forEach(records, (quote) => {
					const quoteLines = lines.filter((line) => line.quote_id === quote.id);
					const code = String(quote.doc_no ?? quote.id).replace(/[^a-z0-9_-]/gi, '_');

					return Effect.map(
						decodeQuoteExport({
							schema: 'norbital.crm.confirmed_quote.v1',
							quote: {
								doc_no: quote.doc_no,
								title: quote.title,
								status: quote.status,
								currency: quote.currency,
								net: quote.net,
								tax: quote.tax,
								gross: quote.gross,
								confirmed_at: quote.confirmed_at
							},
							lines: quoteLines.map((line) => ({
								product_code: line.product_code,
								product_name: line.product_name,
								quantity: line.quantity,
								unit_price: line.unit_price,
								discount_pct: line.discount_pct,
								tax_rate: line.tax_rate,
								line_total: line.line_total
							}))
						}),
						(content) => ({
							label: `Confirmed quote · ${quote.doc_no}`,
							attachments: [
								{
									name: `quote_${code}.json`,
									contentType: 'JSON' as const,
									content
								}
							],
							metadata: {
								schema: 'norbital.crm.confirmed_quote.v1',
								quote_id: quote.id,
								doc_no: quote.doc_no
							}
						})
					);
				});
			})
	}
} satisfies Pipelines;
