import { Effect } from 'effect';
import { expect, layer } from '@effect/vitest';
import { Trade, committed, shared, draft, confirm } from './kit.js';
import { sourceOrder, sourcePayment, sourceTransaction } from './synced-kit.js';

layer(shared(), { excludeTestServices: true })('order archive', (test) => {
	test.effect(
		'archiving retains the confirmed terms, issued transactions and active payments',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const as = yield* t.as(t.admin);
				const own = yield* draft(t);
				yield* confirm(t, own.order);
				const before = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
					.orders.rows[0];
				if (!before) throw new Error('Confirmed order required');
				const parent = yield* sourceOrder(t, own.order);
				const delivery = yield* sourceTransaction(t, own, parent, 'delivery');
				const invoice = yield* sourceTransaction(t, own, parent);
				const payment = yield* sourcePayment(t, parent, invoice.id, '2');
				// the retained evidence: both documents, the payment and the order's source counterpart
				const evidence = () =>
					as.query({
						transactions: { where: { id: { in: [delivery.id, invoice.id] } } },
						source_payments: { where: { id: { eq: payment.id } } }
					});
				const retained = yield* evidence();
				committed(
					'orders',
					yield* as.act({
						'orders.update': [{ target: yield* t.at('orders', own.order), set: { archived: true } }]
					})
				);
				expect(
					(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders
						.rows[0]
				).toMatchObject({
					archived: true,
					status: 'confirmed',
					payment_terms: before.payment_terms,
					total: before.total
				});
				expect(yield* evidence()).toEqual(retained);
			})
	);

	test.effect('an archived draft is read-only until unarchived and needs no status reason', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const as = yield* t.as(t.admin);
			const own = yield* draft(t);
			const line = (yield* as.query({ order_lines: { where: { id: { eq: own.line } }, limit: 1 } }))
				.order_lines.rows[0];
			committed(
				'orders',
				yield* as.act({
					'orders.update': [{ target: yield* t.at('orders', own.order), set: { archived: true } }]
				})
			);
			expect(
				yield* as
					.act({
						'orders.update': [
							{
								target: yield* t.at('orders', own.order),
								set: { notes: 'Cannot edit archived remarks' }
							}
						]
					})
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* as
					.act({
						'order_lines.update': [
							{ target: yield* t.at('order_lines', own.line), set: { quantity: '12' } }
						]
					})
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(yield* confirm(t, own.order).pipe(Effect.flip)).toMatchObject({ _tag: 'ActRefused' });
			expect(
				(yield* as.query({ order_lines: { where: { id: { eq: own.line } }, limit: 1 } }))
					.order_lines.rows[0]
			).toEqual(line);
			committed(
				'orders',
				yield* as.act({
					'orders.update': [{ target: yield* t.at('orders', own.order), set: { archived: false } }]
				})
			);
			committed(
				'orders',
				yield* as.act({
					'orders.update': [
						{
							target: yield* t.at('orders', own.order),
							set: { notes: 'Customer may resume later' }
						}
					]
				})
			);
			committed(
				'order_lines',
				yield* as.act({
					'order_lines.update': [
						{ target: yield* t.at('order_lines', own.line), set: { quantity: '12' } }
					]
				})
			);
			expect(
				(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
			).toMatchObject({
				status: 'draft',
				archived: false,
				notes: 'Customer may resume later'
			});
		})
	);
});
