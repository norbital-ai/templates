import { fixtureId } from './test-runtime.js';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { direct } from './synced-kit.js';
import { committed, confirm, SETTINGS, workspace } from './kit.js';
import { kingdeeDraft, kingdeeFixture } from './kingdee-fixture.js';
test.live(
	'configuration edits the authoritative settings without creating ignored alternatives',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.member(['configuration']));
			const before = (yield* as.query({
				commercial_settings: { where: { id: { eq: SETTINGS } }, limit: 1 }
			})).commercial_settings.rows[0];
			expect(before).toMatchObject({ code: 'default' });
			expect(
				yield* direct(t, as.authority, {
					model: 'commercial_settings',
					verb: 'create',
					input: [{ code: 'unused' }]
				})
			).not.toMatchObject({ kind: 'committed' });
			committed(
				'commercial_settings',
				yield* as.act('commercial_settings.update', [
					{
						target: SETTINGS,
						set: { stock_fresh_minutes: 21 }
					}
				])
			);
			expect((yield* as.query({ commercial_settings: {} })).commercial_settings.rows).toHaveLength(
				1
			);
			expect(
				(yield* as.query({ commercial_settings: { where: { id: { eq: SETTINGS } }, limit: 1 } }))
					.commercial_settings.rows[0]
			).toMatchObject({
				code: 'default',
				stock_fresh_minutes: 21
			});
		})
);
test.live(
	'configuration owns the accounting instance settings while source identity remains fixed',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.member(['configuration']));
			// the named connection starts with its definition's defaults, like any instance
			expect(
				(yield* as.query({
					sys_integration: {
						where: { id: { eq: fixtureId('sys_integration', 'kingdee') } },
						limit: 1
					}
				})).sys_integration.rows[0]
			).toMatchObject({
				integration: 'kingdee',
				configuration: { fullSnapshotMinutes: 1440, maxWindowMinutes: 15 }
			});
			committed(
				'sys_integration',
				yield* as.act('sys_integration.update', [
					{
						target: fixtureId('sys_integration', 'kingdee'),
						set: {
							configuration: { fullSnapshotMinutes: 60, maxWindowMinutes: 20 }
						}
					}
				])
			);
			expect(
				(yield* as.query({
					sys_integration: {
						where: { id: { eq: fixtureId('sys_integration', 'kingdee') } },
						limit: 1
					}
				})).sys_integration.rows[0]
			).toMatchObject({
				integration: 'kingdee',
				configuration: { maxWindowMinutes: 20 }
			});
			// the definition bounds the health limits the feed reads, and an omitted one is its default again
			expect(
				yield* Effect.flip(
					as.act('sys_integration.update', [
						{
							target: fixtureId('sys_integration', 'kingdee'),
							set: { configuration: { maxWindowMinutes: 0 } }
						}
					])
				)
			).toMatchObject({
				_tag: 'ActRefused',
				message: expect.stringContaining('maxWindowMinutes is out of range')
			});
			committed(
				'sys_integration',
				yield* as.act('sys_integration.update', [
					{
						target: fixtureId('sys_integration', 'kingdee'),
						set: { configuration: {} }
					}
				])
			);
			expect(
				(yield* as.query({
					sys_integration: {
						where: { id: { eq: fixtureId('sys_integration', 'kingdee') } },
						limit: 1
					}
				})).sys_integration.rows[0]
			).toMatchObject({
				configuration: { fullSnapshotMinutes: 1440, maxWindowMinutes: 15 }
			});
			expect(
				yield* direct(t, as.authority, {
					model: 'sys_integration',
					verb: 'update',
					input: [{ target: 'kingdee', set: { integration: 'email' } }]
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* Effect.flip(
					t.as(t.member(['sales'])).act('sys_integration.update', [
						{
							target: fixtureId('sys_integration', 'kingdee'),
							set: { active: false }
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
);
test.live(
	'a paused ledger keeps the approved write queued until it is resumed, then sends it once',
	() =>
		Effect.gen(function* () {
			const source = kingdeeFixture();
			const t = yield* workspace({ source: source.request });
			const own = yield* kingdeeDraft(t, source);
			const as = t.as(t.member(['configuration']));
			committed(
				'sys_integration',
				yield* as.act('sys_integration.update', [
					{
						target: fixtureId('sys_integration', 'kingdee'),
						set: { active: false }
					}
				])
			);
			yield* confirm(t, own.order);
			const before = (yield* t
				.as(t.admin)
				.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0];
			expect(yield* t.deliver()).toEqual({ delivered: 0 });
			expect(source.submissions.size).toBe(0);
			const [pending] = yield* t.db.read([
				{
					text: "SELECT status FROM sys_outbox WHERE model = 'orders' AND sync = 'orders.sync.kingdee' AND record = $1 ORDER BY seq",
					params: [own.order]
				}
			]);
			expect(pending?.rows).toEqual([{ status: 'queued' }]);
			committed(
				'sys_integration',
				yield* as.act('sys_integration.update', [
					{
						target: fixtureId('sys_integration', 'kingdee'),
						set: { active: true }
					}
				])
			);
			t.clock.advance('1min');
			expect(yield* t.deliver()).toEqual({ delivered: 1 });
			expect(yield* t.deliver()).toEqual({ delivered: 0 });
			expect(source.submissions.size).toBe(1);
			expect(source.calls.filter((request) => request.transaction === 'serializable')).toHaveLength(
				1
			);
			const [submitted] = yield* t.db.read([
				{
					text: "SELECT status, attempts, error, result IS NOT NULL AS submitted FROM sys_outbox WHERE model = 'orders' AND sync = 'orders.sync.kingdee' AND record = $1 ORDER BY seq",
					params: [own.order]
				}
			]);
			expect(submitted?.rows).toEqual([
				{ status: 'acked', attempts: 1, error: null, submitted: true }
			]);
			expect(
				(yield* t.as(t.admin).query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
					.orders.rows[0]
			).toMatchObject({
				revision: before?.revision,
				seal_hash: before?.seal_hash
			});
		})
);
