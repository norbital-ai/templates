import { fixtureId } from './test-runtime.js';
import { Context, Effect, Exit } from 'effect';
import { expect, it, layer } from '@effect/vitest';
import { Syncs } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { direct } from './synced-kit.js';
import { committed, SETTINGS, shared, Trade, workspace } from './kit.js';
import { sourceFixture } from './source-fixture.js';
layer(shared(), { excludeTestServices: true })('configuration', (test) => {
	test.effect(
		'configuration edits the authoritative settings without creating ignored alternatives',
		() =>
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
				expect(
					yield* Effect.flip(
						as.act('commercial_settings.update', [
							{ target: SETTINGS, set: { stock_fresh_minutes: 21 } }
						])
					)
				).toMatchObject({ _tag: 'ActRefused' });
				committed(
					'commercial_settings',
					yield* as.act('commercial_settings.update', [
						{ target: SETTINGS, set: { require_floor: true } }
					])
				);
				committed(
					'commercial_settings',
					yield* t
						.as(t.admin)
						.act('commercial_settings.update', [
							{ target: SETTINGS, set: { stock_fresh_minutes: 21 } }
						])
				);
				expect(
					(yield* as.query({ commercial_settings: {} })).commercial_settings.rows
				).toMatchObject([
					{ id: SETTINGS, code: 'default', stock_fresh_minutes: 21, require_floor: true }
				]);
			})
	);
	test.effect('only workspace administrators can change the accounting connection', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const kingdee = fixtureId('sys_integration', 'kingdee');
			committed(
				'sys_integration',
				yield* t
					.as(t.admin)
					.act('sys_integration.update', [
						{ target: kingdee, set: { configuration: { maxWindowMinutes: 20 } } }
					])
			);
			for (const team of ['configuration', 'sales'] as const)
				expect(
					yield* Effect.flip(
						t
							.as(t.member([team]))
							.act('sys_integration.update', [{ target: kingdee, set: { active: false } }])
					)
				).toMatchObject({ _tag: 'ActRefused' });
		})
	);
});

it.effect(
	'Kingdee pairing checks SELECT access on every configured master and stock projection',
	() =>
		Effect.gen(function* () {
			const metadata = sourceFixture(() => ({}));
			const reads: string[] = [];
			let canReadStock = false;
			const t = yield* workspace({
				source: (operation) => {
					const statement = operation.op === 'call' ? operation.arguments.stmt : undefined;
					if (typeof statement !== 'string' || !statement.startsWith('SELECT TOP 0 '))
						return metadata(operation);
					reads.push(statement);
					return !canReadStock && statement.includes('[dbo].[ICInventory]')
						? Effect.fail(new FacilityFailure({ kind: 'upstream', message: 'SELECT denied' }))
						: Effect.succeed({ rows: [] });
				}
			});
			const testConnection = () => Context.get(t.services, Syncs).test('kingdee');
			expect(Exit.isFailure(yield* Effect.exit(testConnection()))).toBe(true);
			expect(reads).toHaveLength(4);
			expect(reads.at(-1)).toContain('[dbo].[ICInventory]');
			canReadStock = true;
			yield* testConnection();
			expect(reads).toHaveLength(8);
		})
);
