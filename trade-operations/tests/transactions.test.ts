import { firstRow, decimalText, sameDecimal } from './test-runtime.js';
import { Effect } from 'effect';
import { expect, layer } from '@effect/vitest';
import { Trade, shared, draft, confirm, committed, PRODUCT } from './kit.js';
import { sourceOrder, sourceTransaction, sync } from './synced-kit.js';
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
				expect(yield* sync(t, 'transactions', [{ ...invoice.input, documents: [] }])).toMatchObject(
					{ kind: 'committed' }
				);
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
					{ order: null }
				])
					expect(
						yield* sync(t, 'transactions', [{ ...invoice.input, ...change }])
					).not.toMatchObject({ kind: 'committed' });
				expect(
					(yield* (yield* t.as(t.admin)).query({
						transactions: { where: { id: { eq: invoice.id } }, limit: 1 }
					})).transactions.rows[0]
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
				const replay = () => sync(t, 'transactions', [delivery.input]);
				yield* Effect.all([replay(), replay()], { concurrency: 2, mode: 'result' });
				for (const items of [
					[{ ...item, order_line_id: foreign.line }],
					[item, item],
					[{ ...item, quantity: '-10' }]
				])
					expect(yield* sync(t, 'transactions', [{ ...delivery.input, items }])).not.toMatchObject({
						kind: 'committed'
					});
				const result = yield* (yield* t.as(t.admin)).query({
					transactions: { where: { order: { eq: own.order } } }
				});
				expect(result.transactions.rows).toHaveLength(1);
				expect(result.transactions.rows[0]?.id).toBe(delivery.id);
				expect(sameDecimal(result.transactions.rows[0]?.items?.[0]?.quantity, '10')).toBe(true);
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
				expect(yield* sync(t, 'transactions', page)).toMatchObject({
					kind: 'committed'
				});
				const corrected = page.map((row) => ({ ...row, reference: `${row.reference}-corrected` }));
				expect(yield* sync(t, 'transactions', corrected)).toMatchObject({
					kind: 'committed'
				});
				const { transactions } = yield* (yield* t.as(t.admin)).query({
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
					as = yield* t.as(t.admin);
				const other = committed(
					'order_lines',
					yield* as.act({
						'order_lines.create': [
							{
								order: own.order,
								product: PRODUCT,
								quantity: '10',
								unit_price: '2'
							}
						]
					})
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
				const { transactions } = yield* as.query(orderDeliveries(own.order));
				expect(transactions.total).toBe(2);
				const quantities = deliveredByLine(transactions.rows);
				expect(quantities.get(`${own.line}/kg`)).toEqual(decimalText('12'));
				expect(quantities.get(`${other}/kg`)).toEqual(decimalText('3'));
				expect(quantities.get(`${own.line}/t`)).toBeUndefined();
			})
	);

	test.effect('a delivery keeps counting on its line after the confirmed order changes', () =>
		Effect.gen(function* () {
			const t = yield* Trade,
				own = yield* draft(t),
				as = yield* t.as(t.admin);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order);
			yield* sourceTransaction(t, own, parent, 'delivery', '4');
			committed(
				'order_lines',
				yield* as.act({
					'order_lines.update': [
						{ target: yield* t.at('order_lines', own.line), set: { quantity: '12' } }
					]
				})
			);
			const { transactions } = yield* as.query(orderDeliveries(own.order));
			expect(deliveredByLine(transactions.rows).get(`${own.line}/kg`)).toEqual(decimalText('4'));
		})
	);
});
