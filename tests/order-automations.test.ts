import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { fixtureId } from './test-runtime.js';
import { committed, draft, orderRun, workspace } from './kit.js';

test.live.each(['sales', 'procurement', 'manager'] as const)(
	'%s may start cancellation and closure',
	(policy) =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const member = t.member([policy]),
				caller = t.as(member);
			const own = yield* draft(
				t,
				policy === 'procurement' ? 'purchasing' : 'sales',
				fixtureId('sys_user', member.id)
			);
			// These starts pass admission and reach the business reason check without changing the draft.
			expect(
				yield* orderRun(t, caller, 'orders_cancel', { target: own.order, reason: '' })
			).toMatchObject({
				state: 'failed',
				error: { code: 'refused', message: 'errors.reason_required', field: 'reason' }
			});
			expect(
				yield* orderRun(t, caller, 'orders_close', { target: own.order, reason: '' })
			).toMatchObject({
				state: 'failed',
				error: { code: 'refused', message: 'errors.reason_required', field: 'reason' }
			});
			expect(yield* caller.query('orders', { id: own.order })).toMatchObject({ status: 'draft' });
		})
);

test.live.each(['sales', 'procurement'] as const)(
	'a %s cannot start an order operation outside its read scope',
	(policy) =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const caller = t.as(t.member([policy])),
				admin = t.as(t.admin),
				hidden = yield* draft(t);
			const before = yield* admin.query('orders', { id: hidden.order });
			expect(yield* caller.query('orders', { id: hidden.order })).toBeNull();
			expect(
				yield* caller
					.start('orders_cancel', {
						target: hidden.order,
						reason: 'Try to cancel another order'
					})
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused', code: 'notFound' });
			expect(yield* admin.query('orders', { id: hidden.order })).toEqual(before);
			expect(
				yield* caller
					.start('orders_close', {
						target: hidden.order,
						reason: 'Try to close another order'
					})
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused', code: 'notFound' });
			expect(yield* admin.query('orders', { id: hidden.order })).toEqual(before);
		})
);

test.live(
	'each order operation records a native conflict for a stale revision without changing the order',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const caller = t.as(t.member(['manager'])),
				admin = t.as(t.admin),
				own = yield* draft(t);
			const previous = yield* admin.query('orders', { id: own.order });
			if (previous === null) throw new Error('Draft order required');
			committed(
				'orders',
				yield* admin.act('orders.update', {
					target: own.order,
					set: { title: 'The current agreement' }
				})
			);
			// Settle prior sync work before taking the unchanged-record baseline.
			yield* t.runDue();
			const current = yield* admin.query('orders', { id: own.order });
			if (current === null) throw new Error('Current order required');
			expect(current.revision).toBe(previous.revision + 1);
			const input = { target: own.order, reason: 'A stale edit', revision: previous.revision };
			const attempts = [
				() => orderRun(t, caller, 'orders_cancel', input),
				() => orderRun(t, caller, 'orders_close', input)
			];
			for (const attempt of attempts) {
				expect(yield* attempt()).toMatchObject({
					state: 'failed',
					error: { code: 'conflict', records: [{ collection: 'orders', id: own.order }] }
				});
				expect(yield* admin.query('orders', { id: own.order })).toEqual(current);
			}
		})
);
