import { fixtureId } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Context, Schema, Effect, Option } from 'effect';
import { Approvals } from '@norbital-ai/bolt/engine';
import { expect, it as test } from '@effect/vitest';
import { direct } from './synced-kit.js';
import { committed, workspace, draft, confirm } from './kit.js';
test.live(
	'sales is scoped through every child and configuration never grants commercial rows',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const sales = t.member(['sales']);
			const as = t.as(sales);
			const mine = yield* draft(t, 'sales', fixtureId('sys_user', sales.id));
			const other = yield* draft(t);
			const buy = yield* draft(t, 'purchasing');
			expect((yield* as.read('orders', { all: true })).rows.map((r) => r.id)).toEqual([mine.order]);
			expect((yield* as.read('order_lines', { all: true })).rows.map((r) => r.id)).toEqual([
				mine.line
			]);
			for (const x of [other, buy]) {
				expect(yield* as.get('orders', x.order)).toBeNull();
				expect(
					yield* Effect.flip(
						as.act('order_lines.update', { target: x.line, set: { unit_price: Decimal.of('1') } })
					)
				).toMatchObject({ _tag: 'ActRefused' });
				yield* Effect.tryPromise({
					try: () =>
						expect(
							Effect.runPromise(as.query('orders.confirmation_check', { order: x.order }))
						).rejects.toThrow(),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
			}
			committed(
				'activities',
				yield* as.act('activities.create', {
					order: mine.order,
					title: 'Call customer',
					kind: 'call'
				})
			);
			expect(
				yield* Effect.flip(
					as.act('activities.create', {
						order: buy.order,
						title: 'Sneak into purchasing',
						kind: 'note'
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(t.as(t.member(['configuration'])).read('orders', { all: true }))
					).rejects.toThrow(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(
				yield* direct(t, as.authority, {
					collection: 'products',
					verb: 'update',
					input: {
						target: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
						set: { name: 'Overwrite ERP' }
					}
				})
			).not.toMatchObject({ kind: 'committed' });
		})
);
test.live(
	'logistics reads quantities without changing source transactions or seeing commercial prices',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const { order, line } = yield* draft(t);
			yield* confirm(t, order);
			const as = t.as(t.member(['logistics']));
			const shown = yield* as.get('orders', order);
			expect(shown).toMatchObject({
				sealed_snapshot: { $masked: true },
				sealed_contract: { $masked: true }
			});
			expect(yield* as.get('order_lines', line)).toMatchObject({ unit_price: { $masked: true } });
			expect(
				yield* direct(t, as.authority, {
					collection: 'transactions',
					verb: 'create',
					input: [{ order }]
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* direct(t, as.authority, {
					collection: 'source_payments',
					verb: 'create',
					input: [{ order }]
				})
			).not.toMatchObject({ kind: 'committed' });
		})
);
test.live('native sealing approval requires no credit-approval configuration', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const sales = t.member(['sales'], { teams: ['Sales'], teamPath: ['Sales'] });
		const manager = t.as(
			t.member(['manager'], { teams: ['Commercial Managers'], teamPath: ['Commercial Managers'] })
		);
		const as = t.as(sales);
		const approvals = Context.get(t.services, Approvals);
		const request = (requestId: string, order: string) =>
			approvals
				.view(requestId, as.authority, (collection, id) =>
					Effect.succeed(collection === 'orders' && id === order)
				)
				.pipe(Effect.map(Option.getOrThrow));
		const propose = Effect.fnUntraced(function* () {
			const { order } = yield* draft(t, 'sales', fixtureId('sys_user', sales.id));
			const check = yield* as.query('orders.confirmation_check', { order });
			const outcome = yield* as.act('orders.update', {
				target: order,
				set: { status: 'confirmed', check_hash: check.check_hash }
			});
			if (outcome.kind !== 'pendingApproval') throw new Error('Native approval required');
			return { order, requestId: outcome.requestId };
		});

		// The confirmation is applied at once and the request holds the sealed order.
		const approved = yield* propose();
		expect(yield* as.get('orders', approved.order)).toMatchObject({
			status: 'confirmed',
			seal_hash: expect.any(String)
		});
		expect(yield* request(approved.requestId, approved.order)).toMatchObject({
			status: 'ONGOING',
			mine: true,
			records: expect.arrayContaining([
				expect.objectContaining({ collection: 'orders', id: approved.order })
			])
		});
		// Nobody outside the request may change it: an administrator cannot cancel it around the approval.
		expect(
			yield* Effect.flip(
				t.as(t.admin).act('orders.update', {
					target: approved.order,
					set: { status: 'cancelled', reason: 'Around the approval' }
				})
			)
		).toMatchObject({ _tag: 'ActRefused', code: 'locked' });
		expect(
			yield* approvals.process({
				requestId: approved.requestId,
				status: 'APPROVED',
				authority: manager.authority,
				now: t.clock.now()
			})
		).toMatchObject({ kind: 'decided', status: 'APPROVED' });
		expect(yield* as.get('orders', approved.order)).toMatchObject({ status: 'confirmed' });

		// Request-for-change leaves the sealed order with its requester; a rejection then rolls it back.
		const returned = yield* propose();
		const move = (status: 'REQUEST_FOR_CHANGE' | 'REJECTED') =>
			approvals.process({
				requestId: returned.requestId,
				status,
				authority: manager.authority,
				now: t.clock.now(),
				reason: 'Check the credit terms'
			});
		expect(yield* move('REQUEST_FOR_CHANGE')).toMatchObject({ status: 'CHANGES_REQUESTED' });
		expect(yield* as.get('orders', returned.order)).toMatchObject({ status: 'confirmed' });
		expect(yield* move('REJECTED')).toMatchObject({ status: 'REJECTED' });
		expect(yield* as.get('orders', returned.order)).toMatchObject({
			status: 'draft',
			seal_hash: null
		});
		expect(
			yield* direct(t, t.as(t.admin).authority, {
				collection: 'transactions',
				verb: 'create',
				input: [{ order: returned.order }]
			})
		).not.toMatchObject({ kind: 'committed' });
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
