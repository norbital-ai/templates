import { firstRow } from './test-runtime.js';
import { Effect } from 'effect';
import { randomUUID } from 'node:crypto';
import { expect, it } from '@effect/vitest';
import { workspace, draft, confirm } from './kit.js';
import { setSalesOrder, sourceOrder, writtenId, sync as write } from './synced-kit.js';
const NOW = '2026-10-10T00:00:00Z';
it.live(
	'source transactions bind to their own order and its issued Kingdee SO, and cannot be relinked',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const own = yield* draft(t),
				foreign = yield* draft(t);
			yield* confirm(t, own.order);
			yield* confirm(t, foreign.order);
			const row = {
				erp_id: `INV-${randomUUID()}`,
				order: own.order,
				kind: 'invoice',
				issued_on: '2026-10-10',
				total: '8.00',
				reference: 'INV-1',
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
			// the SO is not yet issued
			expect(yield* write(t, 'transactions', [row])).not.toMatchObject({ kind: 'committed' });
			yield* sourceOrder(t, own.order);
			writtenId('transactions', yield* write(t, 'transactions', [row]));
			expect(
				yield* write(t, 'transactions', [
					{ ...row, items: [{ ...firstRow(row.items), unit_price: '99' }] }
				])
			).not.toMatchObject({ kind: 'committed' });
			expect(yield* write(t, 'transactions', [{ ...row, order: foreign.order }])).not.toMatchObject(
				{ kind: 'committed' }
			);
			const key = (yield* (yield* t.as(t.admin)).query({
				orders: { where: { id: { eq: own.order } }, limit: 1 }
			})).orders.rows[0]?.source_order_key;
			yield* setSalesOrder(t, key ?? '', 'void');
			writtenId('transactions', yield* write(t, 'transactions', [{ ...row, status: 'void' }]));
			expect(yield* write(t, 'transactions', [row])).not.toMatchObject({
				kind: 'committed'
			});
			expect(
				(yield* (yield* t.as(t.admin)).query({
					transactions: { where: { erp_id: { eq: row.erp_id } } }
				})).transactions.rows[0]
			).toMatchObject({ status: 'void', order: own.order });
		})
);
