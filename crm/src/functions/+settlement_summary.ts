import { defineQueryHandler } from '@norbital-ai/bolt/authoring';
import { Effect, Schema } from 'effect';

/**
 * The remote runtime binds each collection helper as a promise while the authoring surface types
 * it as an effect, so every call is bridged into the program.
 */
const run = <A>(value: PromiseLike<A> | Effect.Effect<A, unknown>): Effect.Effect<A, unknown> =>
	Effect.tryPromise(() => ('then' in value ? value : Effect.runPromise(value)));

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
		Effect.gen(function* () {
			const rows = yield* run(
				api.db.query.settlements.findMany({
					where: { regarding_type: { eq: input.regarding_type } },
					columns: { regarding_id: true, amount: true, currency: true },
					limit: 5000
				})
			);

			const summaries = new Map<string, { paid: number; currency: string }>();
			for (const row of rows) {
				const current = summaries.get(row.regarding_id) ?? {
					paid: 0,
					currency: row.currency ?? ''
				};
				summaries.set(row.regarding_id, {
					paid: current.paid + Number(row.amount ?? 0),
					currency: current.currency
				});
			}

			return {
				summaries: Object.fromEntries(summaries.entries())
			};
		})
});
