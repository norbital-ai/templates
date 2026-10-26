import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { fixtureId } from './test-runtime.js';
import { committed, draft, workspace } from './kit.js';

test.live.each(['sales', 'procurement', 'manager'] as const)(
	'%s can archive and unarchive an accessible order directly',
	(policy) =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const member = t.member([policy]);
			const caller = t.as(member);
			const own = yield* draft(
				t,
				policy === 'procurement' ? 'purchasing' : 'sales',
				fixtureId('sys_user', member.id)
			);
			for (const archived of [true, false]) {
				committed(
					'orders',
					yield* caller.act('orders.update', { target: own.order, set: { archived } })
				);
				expect(yield* caller.query('orders', { id: own.order })).toMatchObject({
					archived,
					status: 'draft'
				});
			}
		})
);

test.live.each(['sales', 'procurement'] as const)(
	'a %s cannot archive an order outside its read scope',
	(policy) =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const caller = t.as(t.member([policy]));
			const admin = t.as(t.admin);
			const hidden = yield* draft(t);
			const before = yield* admin.query('orders', { id: hidden.order });
			expect(yield* caller.query('orders', { id: hidden.order })).toBeNull();
			expect(
				yield* caller
					.act('orders.update', { target: hidden.order, set: { archived: true } })
					.pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(yield* admin.query('orders', { id: hidden.order })).toEqual(before);
		})
);

test.live('archiving with a stale observed revision preserves the current order', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const caller = t.as(t.member(['manager']));
		const admin = t.as(t.admin);
		const own = yield* draft(t);
		const previous = yield* admin.query('orders', { id: own.order });
		if (!previous) throw new Error('Draft order required');
		committed(
			'orders',
			yield* admin.act('orders.update', {
				target: own.order,
				set: { notes: 'Latest customer discussion' }
			})
		);
		yield* t.runDue();
		const current = yield* admin.query('orders', { id: own.order });
		expect(
			yield* caller
				.act(
					'orders.update',
					{
						target: own.order,
						set: { archived: true }
					},
					{ observed: { [own.order]: previous.revision } }
				)
				.pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActConflict', records: [{ collection: 'orders', id: own.order }] });
		expect(yield* admin.query('orders', { id: own.order })).toEqual(current);
	})
);
