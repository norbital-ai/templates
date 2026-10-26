import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace, draft, confirm, orderRun } from './kit.js';
import { sourceOrder, sourceTransaction, sync, writtenId } from './synced-kit.js';
test.live(
	'closure uses one delivery ledger and preserves the agreement when its remainder is released',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace(),
				as = t.as(t.admin),
				own = yield* draft(t);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order),
				before = yield* as.query('orders', { id: own.order });
			const delivery = yield* sourceTransaction(t, own, parent, 'delivery');
			const retained = yield* as.query('transactions', { id: delivery.id });
			expect(
				yield* orderRun(t, as, 'orders_close', { target: own.order, reason: '' })
			).toMatchObject({
				state: 'failed',
				error: { code: 'refused', message: 'errors.reason_required' }
			});
			expect(
				yield* orderRun(t, as, 'orders_close', {
					target: own.order,
					reason: 'Customer releases remainder'
				})
			).toMatchObject({
				state: 'failed',
				error: { code: 'refused', message: 'errors.remote_close_required' }
			});
			writtenId(
				parent.collection,
				yield* sync(t, parent.collection, [{ ...parent.input, status: 'void' }], 'upsert')
			);
			expect(
				yield* orderRun(t, as, 'orders_close', {
					target: own.order,
					reason: 'Customer releases remainder'
				})
			).toMatchObject({ state: 'succeeded', output: null, error: null });
			expect(yield* as.query('orders', { id: own.order })).toMatchObject({
				status: 'closed',
				seal_hash: before?.seal_hash,
				sealed_contract: before?.sealed_contract,
				sealed_snapshot: before?.sealed_snapshot,
				closure_snapshot: [{ order_line: own.line, ordered: '10', fulfilled: '4', released: '6' }]
			});
			expect(yield* as.query('transactions', { id: delivery.id })).toEqual(retained);
			expect(
				yield* orderRun(t, as, 'orders_cancel', {
					target: own.order,
					reason: 'Hide delivery'
				})
			).toMatchObject({
				state: 'failed',
				error: { code: 'refused', message: 'errors.cancel_obligations' }
			});
		})
);
test.live(
	'closing a fully delivered agreement needs no separate handoff or adjustment record',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace(),
				own = yield* draft(t),
				as = t.as(t.admin);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order);
			yield* sourceTransaction(t, own, parent, 'delivery', '10');
			expect(
				yield* orderRun(t, as, 'orders_close', { target: own.order, reason: 'Complete' })
			).toMatchObject({ state: 'succeeded', output: null, error: null });
			expect(yield* as.query('orders', { id: own.order })).toMatchObject({
				status: 'closed',
				closure_snapshot: [{ fulfilled: '10', released: '0' }]
			});
		})
);

test.live.each(['orders_close', 'orders_cancel'] as const)(
	'a sealed SO refuses %s before source void evidence arrives',
	(operation) =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const original = yield* as.query('orders', { id: own.order });
			expect(original).toMatchObject({ status: 'confirmed' });
			expect(original?.seal_hash).toBeTruthy();
			expect(
				(yield* as.query('ext_sales_orders', { where: { order: { eq: own.order } }, all: true }))
					.rows
			).toEqual([]);
			expect(
				yield* orderRun(t, as, operation, {
					target: own.order,
					reason: 'No source confirmation yet'
				})
			).toMatchObject({ state: 'failed', error: { message: 'errors.remote_close_required' } });
			expect(yield* as.query('orders', { id: own.order })).toEqual({
				...original,
				$sync: expect.anything()
			});
		})
);

test.live('an unconfirmed quotation can be cancelled locally without any source order', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		const own = yield* draft(t);
		expect(
			yield* orderRun(t, as, 'orders_cancel', {
				target: own.order,
				reason: 'Customer declined quotation'
			})
		).toMatchObject({ state: 'succeeded' });
		expect(yield* as.query('orders', { id: own.order })).toMatchObject({
			status: 'cancelled',
			seal_hash: null
		});
		expect(
			(yield* as.query('ext_sales_orders', { where: { order: { eq: own.order } }, all: true })).rows
		).toEqual([]);
	})
);
