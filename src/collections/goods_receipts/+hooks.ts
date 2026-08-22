import { Clock, Effect } from 'effect';
import { deskToday } from '../../lib/desk-date.js';
import { docNoSeriesPattern, nextDocNo } from '../../lib/document-numbers.js';
import type { Hooks } from './$types.js';

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Accepts a receipt only against a confirmed purchase order, defaults the received date to today, and assigns the next GRN document number for the year.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						if (!input.purchase_order_id) {
							return yield* Effect.fail(
								new Error('A goods receipt must reference a purchase order.')
							);
						}
						const order = yield* api.db.query.purchase_orders.findFirst({
							where: { id: { eq: input.purchase_order_id } }
						});
						if (!order) {
							return yield* Effect.fail(new Error('Referenced purchase order does not exist.'));
						}
						if (order.status !== 'confirmed') {
							return yield* Effect.fail(
								new Error('Goods can only be received against a confirmed purchase order.')
							);
						}

						const now = new Date(yield* Clock.currentTimeMillis);
						const resolved = {
							...input,
							received_date: input.received_date ?? deskToday(now),
							received_at: input.received_at ?? now
						};

						if (!input.doc_no) {
							const year = now.getFullYear();
							const existing = yield* api.db.query.goods_receipts.findMany({
								where: { doc_no: { like: docNoSeriesPattern('GRN', year) } },
								columns: { doc_no: true },
								limit: 5000
							});
							return {
								...resolved,
								doc_no: nextDocNo(
									existing.map((row) => row.doc_no),
									'GRN',
									year
								)
							};
						}

						return resolved;
					})
			}
		}
	}
} satisfies Hooks;
