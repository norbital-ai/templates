import { defineQueryHandler } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect, Schema } from 'effect';

/**
 * Paid-to-date per document for one regarding type, so tables can derive
 * paid / partial / unpaid at render without reading every settlement row per document.
 * The status itself is never stored: a surface compares `paid` against the document gross
 * and shows an em-dash for anything that is not committed.
 */
export default defineQueryHandler({
	description:
		'Totals the amount settled to date against each quote, purchase order or purchase invoice of the requested type.',
	schema: Schema.Struct({
		regarding_type: Schema.Literals(['quotes', 'purchase_orders', 'purchase_invoices'])
	}),
	handler: (input, api) =>
		Effect.map(
			api.db.settlements.findMany({
				where: { regarding_type: { eq: input.regarding_type } },
				columns: { regarding_id: true, amount: true, currency: true },
				limit: 5000
			}),
			(rows) => {
				const summaries = new Map<string, { paid: number; currency: string }>();
				for (const row of rows) {
					const current = summaries.get(row.regarding_id) ?? {
						paid: 0,
						currency: row.currency ?? ''
					};
					summaries.set(row.regarding_id, {
						paid: current.paid + decodeNumber(row.amount ?? 0),
						currency: current.currency
					});
				}

				return {
					summaries: Object.fromEntries(summaries.entries())
				};
			}
		)
});
