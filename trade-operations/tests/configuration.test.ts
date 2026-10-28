import { fixtureId } from './test-runtime.js';
import { Effect } from 'effect';
import { expect, layer } from '@effect/vitest';
import { direct } from './synced-kit.js';
import { committed, SETTINGS, shared, Trade } from './kit.js';
layer(shared(), { excludeTestServices: true })('configuration', (test) => {
	test.effect('configuration edits the authoritative settings without creating ignored alternatives', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const as = t.as(t.member(['configuration']));
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
					{ target: SETTINGS, set: { stock_fresh_minutes: 21 } }
				])
			);
			expect((yield* as.query({ commercial_settings: {} })).commercial_settings.rows).toMatchObject([
				{ id: SETTINGS, code: 'default', stock_fresh_minutes: 21 }
			]);
		})
	);
	test.effect('configuration owns the accounting instance settings; sales cannot change them', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const kingdee = fixtureId('sys_integration', 'kingdee');
			committed(
				'sys_integration',
				yield* t
					.as(t.member(['configuration']))
					.act('sys_integration.update', [
						{ target: kingdee, set: { configuration: { maxWindowMinutes: 20 } } }
					])
			);
			expect(
				yield* Effect.flip(
					t
						.as(t.member(['sales']))
						.act('sys_integration.update', [{ target: kingdee, set: { active: false } }])
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
	);
});
