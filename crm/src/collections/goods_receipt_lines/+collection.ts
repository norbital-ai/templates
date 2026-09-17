import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import { allocationLedger } from '../../lib/document-lines.js';
import { uniqueIds } from '../../lib/lifecycle.js';
import model from './+model.js';

const create = {
	input: {
		columns: { goods_receipt_id: true, purchase_order_line_id: true, quantity_received: true }
	}
} as const;

const LIMIT = 5000;

/**
 * Ties a received line to a purchase order line on the same order and rejects a delivery that
 * would take the cumulative received quantity past the quantity ordered. A receipt line is an
 * event: written once, never edited.
 */
export default defineCollection({
	model,
	create,
	transform: (inputs, { db }) =>
		Effect.gen(function* () {
			const receiptIds = uniqueIds(inputs.map((input) => input.goods_receipt_id));
			const orderLineIds = uniqueIds(inputs.map((input) => input.purchase_order_line_id));
			const [receipts, orderLines, prior] = yield* Effect.all(
				[
					db.goods_receipts.findMany({ where: { id: { in: receiptIds } }, limit: LIMIT }),
					db.purchase_order_lines.findMany({ where: { id: { in: orderLineIds } }, limit: LIMIT }),
					db.goods_receipt_lines.findMany({
						where: { purchase_order_line_id: { in: orderLineIds } },
						columns: { purchase_order_line_id: true, quantity_received: true },
						limit: LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
			const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
			const orderLineById = new Map(orderLines.map((line) => [line.id, line]));
			const received = allocationLedger(
				prior,
				(line) => line.purchase_order_line_id,
				(line) => line.quantity_received
			);

			return inputs.map((input) => {
				const receipt = receiptById.get(input.goods_receipt_id);
				if (!receipt) refuse('Referenced goods receipt does not exist.');
				const orderLine = orderLineById.get(input.purchase_order_line_id);
				if (!orderLine) refuse('Referenced purchase order line does not exist.');
				if (orderLine.purchase_order_id !== receipt.purchase_order_id) {
					refuse('The received line belongs to a different purchase order.');
				}
				const quantity = decodeNumber(input.quantity_received);
				if (Number.isNaN(quantity) || quantity <= 0) {
					refuse('Received quantity must be greater than zero.');
				}
				received.claim(
					orderLine.id,
					quantity,
					decodeNumber(orderLine.quantity ?? 0),
					(soFar, ordered) =>
						`Over-delivery: ${soFar} of ${ordered} received so far; this receipt would exceed the ordered quantity.`
				);
				return { ...input, quantity_received: quantity };
			});
		})
});
