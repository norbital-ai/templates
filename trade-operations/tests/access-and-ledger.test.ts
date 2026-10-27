import { Instant } from '@norbital-ai/std/date';
import { fixtureId } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Context, Schema, Effect, Option } from 'effect';
import { Approvals } from '@norbital-ai/bolt/engine';
import { expect, it as test } from '@effect/vitest';
import { direct } from './synced-kit.js';
import { committed, workspace, draft, confirm } from './kit.js';
import { confirmationOf } from './reads.js';
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
			expect((yield* as.query({ orders: {} })).orders.rows.map((r) => r.id)).toEqual([mine.order]);
			expect((yield* as.query({ order_lines: {} })).order_lines.rows.map((r) => r.id)).toEqual([
				mine.line
			]);
			for (const x of [other, buy]) {
				expect(
					(yield* as.query({ orders: { where: { id: { eq: x.order } }, limit: 1 } })).orders.rows[0]
				).toBeUndefined();
				expect(
					yield* Effect.flip(
						as.act('order_lines.update', [{ target: x.line, set: { unit_price: Decimal.of('1') } }])
					)
				).toMatchObject({ _tag: 'ActRefused' });
				yield* Effect.tryPromise({
					try: () =>
						expect(
							Effect.runPromise(
								confirmationOf(as, {
									as_of: Instant(t.clock.now()),
									order: x.order
								})
							)
						).rejects.toThrow(),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
			}
			committed(
				'activities',
				yield* as.act('activities.create', [
					{
						order: mine.order,
						title: 'Call customer',
						kind: 'call'
					}
				])
			);
			expect(
				yield* Effect.flip(
					as.act('activities.create', [
						{
							order: buy.order,
							title: 'Sneak into purchasing',
							kind: 'note'
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(t.as(t.member(['configuration'])).query({ orders: {} }))
					).rejects.toThrow(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(
				yield* direct(t, as.authority, {
					model: 'products',
					verb: 'update',
					input: [
						{
							target: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
							set: { name: 'Overwrite ERP' }
						}
					]
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
			const shown = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
				.rows[0];
			expect(shown).toMatchObject({
				sealed_snapshot: { $masked: true },
				sealed_contract: { $masked: true }
			});
			expect(
				(yield* as.query({ order_lines: { where: { id: { eq: line } }, limit: 1 } })).order_lines
					.rows[0]
			).toMatchObject({
				unit_price: { $masked: true }
			});
			expect(
				yield* direct(t, as.authority, {
					model: 'transactions',
					verb: 'create',
					input: [{ order }]
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* direct(t, as.authority, {
					model: 'source_payments',
					verb: 'create',
					input: [{ order }]
				})
			).not.toMatchObject({ kind: 'committed' });
		})
);
test.live('native sealing approval requires no credit-approval configuration', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const sales = t.member(['sales'], { teams: ['sales'], teamPath: ['sales'] });
		const manager = t.as(
			t.member(['manager'], { teams: ['commercial_managers'], teamPath: ['commercial_managers'] })
		);
		const as = t.as(sales);
		const approvals = Context.get(t.services, Approvals);
		const request = (requestId: string, order: string) =>
			approvals
				.view(requestId, as.authority, (model, id) =>
					Effect.succeed(model === 'orders' && id === order)
				)
				.pipe(Effect.map(Option.getOrThrow));
		const propose = Effect.fnUntraced(function* () {
			const { order } = yield* draft(t, 'sales', fixtureId('sys_user', sales.id));
			const check = yield* confirmationOf(as, {
				as_of: Instant(t.clock.now()),
				order
			});
			const outcome = yield* as.act('orders.update', [
				{
					target: order,
					set: { status: 'confirmed', check_hash: check.check_hash }
				}
			]);
			if (outcome.kind !== 'pendingApproval') throw new Error('Native approval required');
			return { order, requestId: outcome.requestId };
		});

		// The confirmation is applied at once and the request holds the sealed order.
		const approved = yield* propose();
		expect(
			(yield* as.query({ orders: { where: { id: { eq: approved.order } }, limit: 1 } })).orders
				.rows[0]
		).toMatchObject({
			status: 'confirmed',
			seal_hash: expect.any(String)
		});
		expect(yield* request(approved.requestId, approved.order)).toMatchObject({
			status: 'Pending',
			step: 0,
			steps: [{ name: 'Commercial review', teams: ['commercial_managers'], users: [] }],
			mine: true,
			records: expect.arrayContaining([
				expect.objectContaining({ model: 'orders', id: approved.order })
			])
		});
		// Nobody outside the request may change it: an administrator cannot archive it around the approval.
		expect(
			yield* Effect.flip(
				t.as(t.admin).act('orders.update', [
					{
						target: approved.order,
						set: { archived: true }
					}
				])
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* approvals.decide({
				requestId: approved.requestId,
				decision: 'approve',
				authority: manager.authority,
				now: t.clock.now()
			})
		).toMatchObject({ kind: 'decided', status: 'Approved' });
		expect(
			(yield* as.query({ orders: { where: { id: { eq: approved.order } }, limit: 1 } })).orders
				.rows[0]
		).toMatchObject({
			status: 'confirmed'
		});

		// Request-for-change leaves the sealed order with its requester; a rejection then rolls it back.
		const returned = yield* propose();
		const move = (decision: 'requestChanges' | 'reject') =>
			approvals.decide({
				requestId: returned.requestId,
				decision,
				authority: manager.authority,
				now: t.clock.now(),
				reason: 'Check the credit terms'
			});
		expect(yield* move('requestChanges')).toMatchObject({ status: 'ChangesRequested' });
		expect(
			(yield* as.query({ orders: { where: { id: { eq: returned.order } }, limit: 1 } })).orders
				.rows[0]
		).toMatchObject({
			status: 'confirmed'
		});
		expect(yield* move('reject')).toMatchObject({ status: 'Rejected' });
		expect(
			(yield* as.query({ orders: { where: { id: { eq: returned.order } }, limit: 1 } })).orders
				.rows[0]
		).toMatchObject({
			status: 'draft',
			seal_hash: null
		});
		expect(
			yield* direct(t, t.as(t.admin).authority, {
				model: 'transactions',
				verb: 'create',
				input: [{ order: returned.order }]
			})
		).not.toMatchObject({ kind: 'committed' });
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
