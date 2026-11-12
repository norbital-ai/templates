import { firstRow, decimalText } from './test-runtime.js';
import { Effect } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { expect, layer } from '@effect/vitest';
import { Trade, shared, draft, confirm, committed, PRODUCT } from './kit.js';
import { sourceOrder, sourceTransaction, sync } from './synced-kit.js';
import { agreements } from '../src/lib/agreements.js';
import { deliveredByLine, orderDeliveries } from '../src/lib/order-delivery.js';
layer(shared(), { excludeTestServices: true })('transactions', (test) => {
	test.effect(
		'SQL invoices allow absent document files while retaining issued-evidence guards',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade,
					own = yield* draft(t);
				yield* confirm(t, own.order);
				const parent = yield* sourceOrder(t, own.order),
					invoice = yield* sourceTransaction(t, own, parent);
				expect(
					yield* sync(t, 'transactions', [{ ...invoice.input, documents: [] }], 'upsert')
				).toMatchObject({ kind: 'committed' });
				for (const change of [
					{
						documents: [
							{
								name: 'invoice.pdf',
								url: 'http://example.test/invoice.pdf',
								sha256: 'a'.repeat(64)
							}
						]
					},
					{ total: null },
					{ ext_sales_order: null }
				])
					expect(
						yield* sync(t, 'transactions', [{ ...invoice.input, ...change }], 'upsert')
					).not.toMatchObject({ kind: 'committed' });
				expect(
					(yield* t
						.as(t.admin)
						.query({ transactions: { where: { id: { eq: invoice.id } }, limit: 1 } })).transactions
						.rows[0]
				).toMatchObject({
					total: decimalText('21.80'),
					issued_on: '2026-08-01',
					documents: []
				});
			})
	);
	test.effect(
		'delivery replay keeps one row and refuses cross-order lines, duplicate lots and sign changes',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const own = yield* draft(t);
				const foreign = yield* draft(t);
				yield* confirm(t, own.order);
				yield* confirm(t, foreign.order);
				const parent = yield* sourceOrder(t, own.order);
				const delivery = yield* sourceTransaction(t, own, parent, 'delivery', '10');
				const item = delivery.input.items?.[0];
				if (!item) throw new Error('Source item required');
				const replay = () => sync(t, 'transactions', [delivery.input], 'upsert');
				yield* Effect.all([replay(), replay()], { concurrency: 2, mode: 'result' });
				for (const items of [
					[{ ...item, order_line_id: foreign.line }],
					[item, item],
					[{ ...item, quantity: '-10' }]
				])
					expect(
						yield* sync(t, 'transactions', [{ ...delivery.input, items }], 'upsert')
					).not.toMatchObject({ kind: 'committed' });
				const result = yield* t
					.as(t.admin)
					.query({ transactions: { where: { order: { eq: own.order } } } });
				expect(result.transactions.rows).toHaveLength(1);
				expect(result.transactions.rows[0]?.id).toBe(delivery.id);
				expect(result.transactions.rows[0]?.items?.[0]?.quantity.eq(10)).toBe(true);
			})
	);

	test.effect(
		'replays a full page of evidence for one order without exhausting the parent lookup',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const own = yield* draft(t);
				yield* confirm(t, own.order);
				const parent = yield* sourceOrder(t, own.order);
				const delivery = yield* sourceTransaction(t, own, parent, 'delivery', '1');
				const page = Array.from({ length: 501 }, (_, i) => ({
					...delivery.input,
					erp_id: `bulk:${i}`,
					reference: `DO-${i}`
				}));
				expect(yield* sync(t, 'transactions', page, 'upsert')).toMatchObject({
					kind: 'committed'
				});
				const corrected = page.map((row) => ({ ...row, reference: `${row.reference}-corrected` }));
				expect(yield* sync(t, 'transactions', corrected, 'upsert')).toMatchObject({
					kind: 'committed'
				});
				const { transactions } = yield* t.as(t.admin).query({
					transactions: { where: { order: { eq: own.order } }, fields: ['erp_id', 'reference'] }
				});
				expect(transactions.rows).toHaveLength(page.length + 1);
				expect(
					transactions.rows.filter((row) => row.reference.endsWith('-corrected'))
				).toHaveLength(page.length);
			})
	);

	test.effect(
		'uses exact line identities in a mixed delivery and applies linked returns without capping overdelivery',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade,
					own = yield* draft(t),
					as = t.as(t.admin);
				const other = committed(
					'order_lines',
					yield* as.act('order_lines.create', [
						{
							order: own.order,
							product: PRODUCT,
							quantity: Decimal.of('10'),
							unit_price: Decimal.of('2')
						}
					])
				);
				yield* confirm(t, own.order);
				const parent = yield* sourceOrder(t, own.order);
				const item = (line: string, quantity: string) => ({
					order_line_id: line,
					product_name: 'Resin A',
					unit: 'kg',
					quantity
				});
				yield* sourceTransaction(t, own, parent, 'delivery', '14', {
					items: [item(own.line, '14'), item(other, '3')]
				});
				yield* sourceTransaction(t, own, parent, 'delivery', '-2', {
					items: [item(own.line, '-2')]
				});
				yield* sourceTransaction(t, own, parent, 'invoice', '7');
				const order = firstRow(
					(yield* as.query({ orders: { where: { id: { eq: own.order } } } })).orders.rows
				);
				const history = agreements(order);
				const selected = firstRow(history);
				const { transactions } = yield* as.query(orderDeliveries(own.order));
				expect(transactions.total).toBe(2);
				const quantities = deliveredByLine(selected, history, transactions.rows);
				expect(quantities.get(own.line)).toEqual(decimalText('12'));
				expect(quantities.get(other)).toEqual(decimalText('3'));
				const changed = {
					...selected,
					snapshot: {
						...selected.snapshot,
						lines: selected.snapshot.lines.map((line) =>
							line.id === own.line ? { ...line, product: 'different-sku' } : line
						)
					}
				};
				const changedQuantities = deliveredByLine(changed, history, transactions.rows);
				expect(changedQuantities.get(own.line)).toBeUndefined();
				expect(changedQuantities.get(other)).toEqual(decimalText('3'));
			})
	);
});
