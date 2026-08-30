import { refuse } from '@norbital-ai/bolt/authoring';
import { Effect } from 'effect';
import { currentInstant } from '../../lib/clock.js';
import { deskToday } from '../../lib/desk-date.js';
import { docNoSeriesPattern, nextDocNo } from '../../lib/document-numbers.js';
import type { Hooks } from './$types.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Accepts a receipt only against a confirmed purchase order, defaults the received date to today, and assigns the next GRN document number for the year.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						if (!input.purchase_order_id)
							refuse('A goods receipt must reference a purchase order.');
						const order = yield* api.db.purchase_orders.findFirst({
							where: { id: { eq: input.purchase_order_id } }
						});
						if (!order) refuse('Referenced purchase order does not exist.');
						if (order.status !== 'confirmed') {
							refuse('Goods can only be received against a confirmed purchase order.');
						}

						const now = yield* currentInstant;
						const resolved = {
							...input,
							received_date: input.received_date ?? deskToday(now),
							received_at: input.received_at ?? now.toISOString()
						};

						if (!input.doc_no) {
							const year = now.getFullYear();
							const existing = yield* api.db.goods_receipts.findMany({
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
