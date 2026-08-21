import { defineQueryHandler } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';

/**
 * The remote runtime binds each collection helper as a promise while the authoring surface types
 * it as an effect, so every call is bridged into the program.
 */
const run = <A>(value: PromiseLike<A> | Effect.Effect<A, unknown>): Effect.Effect<A, unknown> =>
	Effect.tryPromise(() => ('then' in value ? value : Effect.runPromise(value)));

/**
 * The three-way match for one purchase order: ordered quantity from the order lines,
 * received quantity from goods receipts, invoiced quantity from live purchase invoices.
 * Cancelled invoices do not count toward invoiced; receipts are immutable events.
 */
export default defineQueryHandler({
	description:
		'Reports ordered, received and invoiced quantities line by line for one purchase order, plus what is still outstanding to receive.',
	schema: Schema.Struct({ purchase_order_id: Schema.String }),
	handler: (input, api) =>
		Effect.gen(function* () {
			const orderLines = yield* run(
				api.db.query.purchase_order_lines.findMany({
					where: { purchase_order_id: { eq: input.purchase_order_id } },
					columns: {
						norbital_id: true,
						product_code: true,
						product_name: true,
						quantity: true
					},
					limit: 5000
				})
			);
			const lineIds = orderLines.map((line) => line.norbital_id);
			if (lineIds.length === 0) return { lines: [] };

			const [receiptLines, invoiceLines] = yield* Effect.all(
				[
					run(
						api.db.query.goods_receipt_lines.findMany({
							where: { purchase_order_line_id: { in: lineIds } },
							columns: { purchase_order_line_id: true, quantity_received: true },
							limit: 5000
						})
					),
					run(
						api.db.query.purchase_invoice_lines.findMany({
							where: {
								purchase_order_line_id: { in: lineIds },
								purchase_invoice_line_invoice: { status: { ne: 'cancelled' } }
							},
							columns: {
								purchase_order_line_id: true,
								purchase_invoice_id: true,
								quantity: true
							},
							limit: 5000
						})
					)
				],
				{ concurrency: 'unbounded' }
			);

			const received = new Map<string, number>();
			for (const line of receiptLines) {
				const id = line.purchase_order_line_id;
				received.set(id, (received.get(id) ?? 0) + Number(line.quantity_received ?? 0));
			}
			const invoiced = new Map<string, number>();
			for (const line of invoiceLines) {
				const id = line.purchase_order_line_id;
				invoiced.set(id, (invoiced.get(id) ?? 0) + Number(line.quantity ?? 0));
			}

			return {
				lines: orderLines.map((line) => {
					const ordered = Number(line.quantity ?? 0);
					const receivedQty = received.get(line.norbital_id) ?? 0;
					const invoicedQty = invoiced.get(line.norbital_id) ?? 0;
					return {
						purchase_order_line_id: line.norbital_id,
						product_code: line.product_code,
						product_name: line.product_name,
						ordered,
						received: receivedQty,
						invoiced: invoicedQty,
						remaining_to_receive: ordered - receivedQty
					};
				})
			};
		})
});
