import { firstRow } from './test-runtime.js';
import { Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import { randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { workspace, draft, confirm, type T } from './kit.js';
import { writtenId, sync as write } from './synced-kit.js';
const NOW = '2026-10-10T00:00:00Z';
const receipt = Effect.fnUntraced(function* (
	t: T,
	order: Id<'orders'>,
	external_id: string = randomUUID()
) {
	const seal = (yield* t.as(t.admin).query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
		.orders.rows[0];
	return {
		order,
		external_id,
		reference: 'SOURCE-1',
		agreement_hash: String(seal?.seal_hash),
		currency: 'SGD',
		status: 'issued',
		source_updated_at: NOW
	};
});
it.live(
	'source confirmations and transactions bind to their own sealed agreement and issued parent, and cannot be relinked',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const own = yield* draft(t),
				foreign = yield* draft(t);
			yield* confirm(t, own.order);
			yield* confirm(t, foreign.order);
			const source = yield* receipt(t, own.order);
			expect(
				yield* write(t, 'ext_sales_orders', { ...source, agreement_hash: 'wrong' })
			).not.toMatchObject({ kind: 'committed' });
			const parent = writtenId('ext_sales_orders', yield* write(t, 'ext_sales_orders', source));
			const relinked = yield* receipt(t, foreign.order, source.external_id);
			expect(yield* write(t, 'ext_sales_orders', [relinked], 'upsert')).not.toMatchObject({
				kind: 'committed'
			});
			expect(
				(yield* t
					.as(t.admin)
					.query({ ext_sales_orders: { where: { external_id: { eq: source.external_id } } } }))
					.ext_sales_orders.rows[0]?.order
			).toBe(own.order);
			const other = writtenId(
				'ext_sales_orders',
				yield* write(t, 'ext_sales_orders', yield* receipt(t, foreign.order))
			);
			const row = {
				erp_id: `INV-${randomUUID()}`,
				order: own.order,
				ext_sales_order: parent,
				kind: 'invoice',
				issued_on: '2026-10-10',
				total: '8.00',
				reference: 'INV-1',
				seal_hash: source.agreement_hash,
				currency: 'SGD',
				status: 'issued',
				items: [
					{
						order_line_id: own.line,
						product_name: 'Resin A',
						unit: 'kg',
						quantity: '4',
						unit_price: '2'
					}
				],
				documents: [],
				source_updated_at: NOW
			};
			writtenId('transactions', yield* write(t, 'transactions', [row], 'upsert'));
			expect(
				yield* write(
					t,
					'transactions',
					[{ ...row, items: [{ ...firstRow(row.items), unit_price: '99' }] }],
					'upsert'
				)
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* write(t, 'transactions', [{ ...row, ext_sales_order: other }], 'upsert')
			).not.toMatchObject({ kind: 'committed' });
			writtenId(
				'ext_sales_orders',
				yield* write(t, 'ext_sales_orders', [{ ...source, status: 'void' }], 'upsert')
			);
			writtenId(
				'transactions',
				yield* write(t, 'transactions', [{ ...row, status: 'void' }], 'upsert')
			);
			expect(yield* write(t, 'transactions', [row], 'upsert')).not.toMatchObject({
				kind: 'committed'
			});
			expect(
				(yield* t.as(t.admin).query({ transactions: { where: { erp_id: { eq: row.erp_id } } } }))
					.transactions.rows[0]
			).toMatchObject({ status: 'void', ext_sales_order: parent });
		})
);
