import { Effect, Schema } from 'effect';
import type { Pipelines } from './$types.js';

/**
 * The JSON attachment body of one confirmed purchase order export.
 *
 * The host hands the attachment to the binding's `transform` for the outbound request, so its shape
 * is the wire contract: schema name, the header facts as they were confirmed, and the lines in the
 * order's own currency. The schema owns the keys and types once; the export below only projects the
 * row into it.
 */
const purchaseOrderExportSchema = Schema.Struct({
	schema: Schema.Literal('norbital.crm.confirmed_purchase_order.v1'),
	purchase_order: Schema.Struct({
		doc_no: Schema.NullOr(Schema.String),
		supplier_code: Schema.NullOr(Schema.String),
		supplier_name: Schema.NullOr(Schema.String),
		status: Schema.NullOr(Schema.Literals(['draft', 'submitted', 'confirmed', 'cancelled'])),
		currency: Schema.NullOr(Schema.Literals(['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD'])),
		net: Schema.NullOr(Schema.Number),
		tax: Schema.NullOr(Schema.Number),
		gross: Schema.NullOr(Schema.Number),
		confirmed_at: Schema.NullOr(Schema.Date)
	}),
	lines: Schema.Array(
		Schema.Struct({
			product_code: Schema.NullOr(Schema.String),
			product_name: Schema.NullOr(Schema.String),
			quantity: Schema.NullOr(Schema.Number),
			unit_cost: Schema.NullOr(Schema.Number),
			tax_rate: Schema.NullOr(Schema.Number),
			line_total: Schema.NullOr(Schema.Number)
		})
	)
});

/** Built once, beside its schema: a decoder rebuilt per exported record is per-record work.*/
const decodePurchaseOrderExport = Schema.decodeUnknownEffect(purchaseOrderExportSchema);

/**
 * The push payload the outbound integration binding delivers.
 *
 * The host runs this export against the outboxed records — a confirmed purchase order and its
 * lines — and the binding's `transform` takes the JSON attachment as the request body. The schema
 * above is the handoff contract: document number, header facts, and the lines exactly as they were
 * confirmed, in the order's own currency.
 */
export default {
	export: {
		description:
			'Packages each confirmed purchase order with its lines as a JSON attachment for the downstream system to receive.',
		handler: ({ records }, api) =>
			Effect.gen(function* () {
				const orderIds = records.map((order) => order.id);
				if (orderIds.length === 0) return [];

				const lines = yield* api.db.purchase_order_lines.findMany({
					where: { purchase_order_id: { in: orderIds } },
					limit: 5000
				});

				return yield* Effect.forEach(records, (order) => {
					const orderLines = lines.filter((line) => line.purchase_order_id === order.id);
					const code = String(order.doc_no ?? order.id).replace(/[^a-z0-9_-]/gi, '_');

					return Effect.map(
						decodePurchaseOrderExport({
							schema: 'norbital.crm.confirmed_purchase_order.v1',
							purchase_order: {
								doc_no: order.doc_no,
								supplier_code: order.supplier_code,
								supplier_name: order.supplier_name,
								status: order.status,
								currency: order.currency,
								net: order.net,
								tax: order.tax,
								gross: order.gross,
								confirmed_at: order.confirmed_at
							},
							lines: orderLines.map((line) => ({
								product_code: line.product_code,
								product_name: line.product_name,
								quantity: line.quantity,
								unit_cost: line.unit_cost,
								tax_rate: line.tax_rate,
								line_total: line.line_total
							}))
						}),
						(content) => ({
							label: `Confirmed purchase order · ${order.doc_no}`,
							attachments: [
								{
									name: `purchase_order_${code}.json`,
									contentType: 'JSON' as const,
									content
								}
							],
							metadata: {
								schema: 'norbital.crm.confirmed_purchase_order.v1',
								purchase_order_id: order.id,
								doc_no: order.doc_no
							}
						})
					);
				});
			})
	}
} satisfies Pipelines;
