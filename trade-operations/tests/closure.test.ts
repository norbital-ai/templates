import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace, draft, confirm, committed } from './kit.js';
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
				before = yield* as.get('orders', own.order);
			const delivery = yield* sourceTransaction(t, own, parent, 'delivery');
			const retained = yield* as.get('transactions', delivery.id);
			expect(
				yield* Effect.flip(as.act('orders.close', { target: own.order, input: { reason: '' } }))
			).toMatchObject({
				_tag: 'ActRefused'
			});
			expect(
				yield* Effect.flip(
					as.act('orders.close', {
						target: own.order,
						input: { reason: 'Customer releases remainder' }
					})
				)
			).toMatchObject({ _tag: 'ActRefused', message: 'errors.remote_close_required' });
			writtenId(
				parent.collection,
				yield* sync(t, parent.collection, [{ ...parent.input, status: 'void' }], 'upsert')
			);
			committed(
				'orders',
				yield* as.act('orders.close', {
					target: own.order,
					input: { reason: 'Customer releases remainder' }
				})
			);
			expect(yield* as.get('orders', own.order)).toMatchObject({
				status: 'closed',
				seal_hash: before?.seal_hash,
				sealed_contract: before?.sealed_contract,
				sealed_snapshot: before?.sealed_snapshot,
				closure_snapshot: [{ order_line: own.line, ordered: '10', fulfilled: '4', released: '6' }]
			});
			expect(yield* as.get('transactions', delivery.id)).toEqual(retained);
			expect(
				yield* Effect.flip(
					as.act('orders.cancel', { target: own.order, input: { reason: 'Hide delivery' } })
				)
			).toMatchObject({ _tag: 'ActRefused' });
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
			committed(
				'orders',
				yield* as.act('orders.close', { target: own.order, input: { reason: 'Complete' } })
			);
			expect(yield* as.get('orders', own.order)).toMatchObject({
				status: 'closed',
				closure_snapshot: [{ fulfilled: '10', released: '0' }]
			});
		})
);
