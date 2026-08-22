import type { CollectionHooks } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import type { WorkspaceSchema } from '$bolt/types.js';
import type { WorkspaceRow } from './$types.js';

const LINE_LIMIT = 5000;

/**
 * The receipts, order lines and quantities already received that this batch refers to, read once.
 *
 * The rule below asks three questions per line and each was a round trip of its own: does the
 * receipt exist, does the order line exist and belong to the same order, and how much of it has
 * already been delivered. Three for the batch now, whatever its size.
 *
 * `prepare` decides nothing. Every refusal is still written once, for one line.
 */
interface GoodsReceiptLineBatch {
	readonly receipts: ReadonlyMap<string, WorkspaceRow<'goods_receipts'>>;
	readonly orderLines: ReadonlyMap<string, WorkspaceRow<'purchase_order_lines'>>;
	readonly receivedByOrderLine: ReadonlyMap<string, number>;
}

/** `Hooks` with what `prepare` returns filled in; see the note in `quote_lines/+hooks.ts`. */
type GoodsReceiptLineHooks = CollectionHooks<
	WorkspaceSchema,
	'goods_receipt_lines',
	GoodsReceiptLineBatch
>;

export default {
	create: {
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				const receiptIds = [
					...new Set(
						inputs.flatMap((input) => (input.goods_receipt_id ? [input.goods_receipt_id] : []))
					)
				];
				const orderLineIds = [
					...new Set(
						inputs.flatMap((input) =>
							input.purchase_order_line_id ? [input.purchase_order_line_id] : []
						)
					)
				];
				const receipts = receiptIds.length
					? yield* api.db.query.goods_receipts.findMany({
							where: { id: { in: receiptIds } },
							limit: LINE_LIMIT
						})
					: [];
				const orderLines = orderLineIds.length
					? yield* api.db.query.purchase_order_lines.findMany({
							where: { id: { in: orderLineIds } },
							limit: LINE_LIMIT
						})
					: [];
				const prior = orderLineIds.length
					? yield* api.db.query.goods_receipt_lines.findMany({
							where: { purchase_order_line_id: { in: orderLineIds } },
							columns: { purchase_order_line_id: true, quantity_received: true },
							limit: LINE_LIMIT
						})
					: [];
				const receivedByOrderLine = new Map<string, number>();
				for (const line of prior) {
					receivedByOrderLine.set(
						line.purchase_order_line_id,
						(receivedByOrderLine.get(line.purchase_order_line_id) ?? 0) +
							Number(line.quantity_received ?? 0)
					);
				}
				return {
					receipts: new Map(receipts.map((receipt) => [receipt.id, receipt])),
					orderLines: new Map(orderLines.map((orderLine) => [orderLine.id, orderLine])),
					receivedByOrderLine
				};
			}),
		perRecord: {
			before: {
				description:
					'Ties a received line to a purchase order line on the same order and rejects a delivery that would take the cumulative received quantity past the quantity ordered.',
				handler: ({ input, prepared }) => {
					if (!input.goods_receipt_id) {
						throw new Error('A goods receipt line must reference a goods receipt.');
					}
					const receipt = prepared.receipts.get(input.goods_receipt_id);
					if (!receipt) throw new Error('Referenced goods receipt does not exist.');

					if (!input.purchase_order_line_id) {
						throw new Error('A goods receipt line must reference a purchase order line.');
					}
					const orderLine = prepared.orderLines.get(input.purchase_order_line_id);
					if (!orderLine) throw new Error('Referenced purchase order line does not exist.');
					if (orderLine.purchase_order_id !== receipt.purchase_order_id) {
						throw new Error('The received line belongs to a different purchase order.');
					}

					const quantity = Number(input.quantity_received);
					if (Number.isNaN(quantity) || quantity <= 0) {
						throw new Error('Received quantity must be greater than zero.');
					}

					const receivedSoFar = prepared.receivedByOrderLine.get(orderLine.id) ?? 0;
					const ordered = Number(orderLine.quantity ?? 0);
					if (receivedSoFar + quantity > ordered) {
						throw new Error(
							`Over-delivery: ${receivedSoFar} of ${ordered} received so far; this receipt would exceed the ordered quantity.`
						);
					}

					return { ...input, quantity_received: quantity };
				}
			}
		}
	}
} satisfies GoodsReceiptLineHooks;
