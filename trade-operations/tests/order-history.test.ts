import { fixtureId } from './test-runtime.js';
import { Context, Schema, Effect } from 'effect';
import { Reads } from '@norbital-ai/bolt/engine';
import { expect, it as test } from '@effect/vitest';
import { workspace, draft, committed, confirm } from './kit.js';
test.live(
	'order history includes scoped activity revisions and masks commercial data for logistics',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const sales = t.member(['sales']);
			const other = t.member(['sales']);
			if (sales.actor.kind !== 'member' || other.actor.kind !== 'member')
				throw new Error('Member required');
			const historyOf = Effect.fnUntraced(function* (
				holder: typeof sales,
				model: string,
				id: string
			) {
				const answers = yield* Context.get(t.services, Reads).run(
					[{ kind: 'history', model, id }],
					{ as: 'caller', authority: t.as(holder).authority },
					{ now: t.clock.now(), today: '2026-10-10', tz: t.manifest.workspace.tz }
				);
				return yield* Schema.decodeUnknownEffect(
					Schema.Array(Schema.Struct({ changed: Schema.Record(Schema.String, Schema.Json) }))
				)(answers[0]);
			});
			const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.actor.id));
			const foreign = yield* draft(t, 'sales', fixtureId('sys_user', other.actor.id));
			const activity = committed(
				'activities',
				yield* t.as(sales).act('activities.create', [
					{
						order: own.order,
						title: 'Follow up',
						owner: fixtureId('sys_user', sales.actor.id)
					}
				])
			);
			expect(
				yield* t.as(sales).act('activities.update', [
					{
						target: activity,
						set: { done: true, notes: 'Customer called' }
					}
				])
			).toMatchObject({ kind: 'committed' });
			const history = yield* historyOf(sales, 'activities', activity);
			expect(history).toHaveLength(2);
			expect(history[1]?.changed).toMatchObject({ done: true, notes: 'Customer called' });
			expect(yield* historyOf(sales, 'orders', foreign.order)).toEqual([]);
			yield* confirm(t, own.order);
			const logistics = t.member(['logistics']);
			const sealedHistory = yield* historyOf(logistics, 'orders', own.order);
			expect(sealedHistory.length).toBeGreaterThan(0);
			expect(sealedHistory.at(-1)?.changed).toMatchObject({
				sealed_contract: { $masked: true },
				sealed_snapshot: { $masked: true }
			});
		})
);
