import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { fixtureId } from './test-runtime.js';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { direct } from './synced-kit.js';
import { committed, confirm, draft, SETTINGS, workspace } from './kit.js';
test.live(
	'configuration edits the authoritative settings without creating ignored alternatives',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.member(['configuration']));
			const before = yield* as.get('commercial_settings', SETTINGS);
			expect(before).toMatchObject({ code: 'default' });
			expect(
				yield* direct(t, as.authority, {
					collection: 'commercial_settings',
					verb: 'create',
					input: { code: 'unused' }
				})
			).not.toMatchObject({ kind: 'committed' });
			committed(
				'commercial_settings',
				yield* as.act('commercial_settings.update', {
					target: SETTINGS,
					set: { stock_fresh_minutes: 21 }
				})
			);
			expect((yield* as.read('commercial_settings', { all: true })).rows).toHaveLength(1);
			expect(yield* as.get('commercial_settings', SETTINGS)).toMatchObject({
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
				yield* as.get('sys_integration', fixtureId('sys_integration', 'kingdee'))
			).toMatchObject({
				integration: 'kingdee',
				configuration: { maxLagMinutes: 15, retentionMinutes: 4320, minRetentionMinutes: 15 }
			});
			committed(
				'sys_integration',
				yield* as.act('sys_integration.update', {
					target: fixtureId('sys_integration', 'kingdee'),
					set: {
						configuration: { maxLagMinutes: 20, retentionMinutes: 4320, minRetentionMinutes: 15 }
					}
				})
			);
			expect(
				yield* as.get('sys_integration', fixtureId('sys_integration', 'kingdee'))
			).toMatchObject({
				integration: 'kingdee',
				configuration: { maxLagMinutes: 20 }
			});
			// the definition bounds the health limits the feed reads, and an omitted one is its default again
			expect(
				yield* Effect.flip(
					as.act('sys_integration.update', {
						target: fixtureId('sys_integration', 'kingdee'),
						set: { configuration: { maxLagMinutes: 0 } }
					})
				)
			).toMatchObject({
				_tag: 'ActRefused',
				message: expect.stringContaining('maxLagMinutes is out of range')
			});
			committed(
				'sys_integration',
				yield* as.act('sys_integration.update', {
					target: fixtureId('sys_integration', 'kingdee'),
					set: { configuration: {} }
				})
			);
			expect(
				yield* as.get('sys_integration', fixtureId('sys_integration', 'kingdee'))
			).toMatchObject({
				configuration: { maxLagMinutes: 15, retentionMinutes: 4320, minRetentionMinutes: 15 }
			});
			expect(
				yield* direct(t, as.authority, {
					collection: 'sys_integration',
					verb: 'update',
					input: { target: 'kingdee', set: { integration: 'email' } }
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* Effect.flip(
					t.as(t.member(['sales'])).act('sys_integration.update', {
						target: fixtureId('sys_integration', 'kingdee'),
						set: { active: false }
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
);
test.live(
	'a paused ledger keeps the approved command queued until it is resumed, then sends it once',
	() =>
		Effect.gen(function* () {
			let requests = 0;
			const t = yield* workspace({
				source: (request) =>
					Effect.try({
						try: () => {
							requests++;
							return {
								rows: [{ remote: 'source-paused-order', hash: request.parameters.hash ?? '' }]
							};
						},
						catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
					})
			});
			const as = t.as(t.member(['configuration']));
			committed(
				'sys_integration',
				yield* as.act('sys_integration.update', {
					target: fixtureId('sys_integration', 'kingdee'),
					set: { active: false }
				})
			);
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const before = yield* t.as(t.admin).get('orders', own.order);
			expect(yield* t.deliver()).toMatchObject({ sent: 0, failed: 0 });
			expect(requests).toBe(0);
			const [pending] = yield* t.db.read([
				{ text: "SELECT status FROM sys_message WHERE class = 'command'", params: [] }
			]);
			expect(pending?.rows).toEqual([{ status: 'queued' }]);
			committed(
				'sys_integration',
				yield* as.act('sys_integration.update', {
					target: fixtureId('sys_integration', 'kingdee'),
					set: { active: true }
				})
			);
			t.clock.advance('1min');
			expect(yield* t.deliver()).toMatchObject({ sent: 1, failed: 0 });
			expect(yield* t.deliver()).toMatchObject({ sent: 0 });
			expect(requests).toBe(1);
			expect(yield* t.as(t.admin).get('orders', own.order)).toMatchObject({
				revision: before?.revision,
				seal_hash: before?.seal_hash
			});
		})
);
