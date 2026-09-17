import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentInstant } from '../../lib/clock.js';
import { deskToday } from '../../lib/desk-date.js';
import { docNoSeries, docNoSeriesPattern } from '../../lib/document-numbers.js';
import { uniqueIds } from '../../lib/lifecycle.js';
import model from './+model.js';

/** `doc_no` and `received_at` are stamped here; a receipt is written once, never edited. */
const create = {
	input: { columns: { purchase_order_id: true, owner_id: true, received_date: true, note: true } }
} as const;

const LIMIT = 5000;

/**
 * Accepts a receipt only against a confirmed purchase order, defaults the received date to today,
 * and assigns the next GRN document number for the year.
 */
export default defineCollection({
	model,
	create,
	transform: (inputs, { db }) =>
		Effect.gen(function* () {
			const now = yield* currentInstant;
			const year = now.getFullYear();
			const orderIds = uniqueIds(inputs.map((input) => input.purchase_order_id));
			const [orders, issued] = yield* Effect.all(
				[
					db.purchase_orders.findMany({ where: { id: { in: orderIds } }, limit: LIMIT }),
					db.goods_receipts.findMany({
						where: { doc_no: { like: docNoSeriesPattern('GRN', year) } },
						columns: { doc_no: true },
						limit: LIMIT
					})
				],
				{ concurrency: 'unbounded' }
			);
			const orderById = new Map(orders.map((order) => [order.id, order]));
			const nextDocNo = docNoSeries(
				issued.map((receipt) => receipt.doc_no),
				'GRN',
				year
			);
			return inputs.map((input) => {
				const order = orderById.get(input.purchase_order_id);
				if (!order) refuse('Referenced purchase order does not exist.');
				if (order.status !== 'confirmed') {
					refuse('Goods can only be received against a confirmed purchase order.');
				}
				return {
					...input,
					doc_no: nextDocNo(),
					received_date: input.received_date ?? deskToday(now),
					received_at: now.toISOString()
				};
			});
		})
});
