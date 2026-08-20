import { Effect } from 'effect';
import type { Hooks } from './$types.js';

const DESK_TIME_ZONE = 'Asia/Singapore';
const DOC_NO_SEQUENCE_WIDTH = 4;

function deskToday(): string {
	const parts = new Intl.DateTimeFormat('en', {
		timeZone: DESK_TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(new Date());
	const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? '';
	return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
}

function docNoSeriesPattern(prefix: string, year: number): string {
	return `${prefix}-${year}-%`;
}

function nextDocNo(existingNumbers: readonly string[], prefix: string, year: number): string {
	const seriesPrefix = `${prefix}-${year}-`;
	let highest = 0;
	for (const number of existingNumbers) {
		if (!number.startsWith(seriesPrefix)) continue;
		const sequence = Number.parseInt(number.slice(seriesPrefix.length), 10);
		if (Number.isNaN(sequence)) continue;
		if (sequence > highest) highest = sequence;
	}
	return `${seriesPrefix}${String(highest + 1).padStart(DOC_NO_SEQUENCE_WIDTH, '0')}`;
}

export default {
	create: {
		perRecord: {
			before: {
				description:
					'Accepts a receipt only against a confirmed purchase order, defaults the received date to today, and assigns the next GRN document number for the year.',
				handler: ({ input, api }) =>
					Effect.gen(function* () {
						if (!input.purchase_order_id) {
							throw new Error('A goods receipt must reference a purchase order.');
						}
						const order = yield* api.db.query.purchase_orders.findFirst({
							where: { norbital_id: { eq: input.purchase_order_id } }
						});
						if (!order) throw new Error('Referenced purchase order does not exist.');
						if (order.status !== 'confirmed') {
							throw new Error('Goods can only be received against a confirmed purchase order.');
						}

						const resolved = {
							...input,
							received_date: input.received_date ?? deskToday(),
							received_at: input.received_at ?? new Date()
						};

						if (!input.doc_no) {
							const year = new Date().getFullYear();
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
