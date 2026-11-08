import { Effect, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { fixtureId } from './test-runtime.js';
import { workspace } from './kit.js';

it.live('a ledger in attention notifies its configuration holders', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const instance = fixtureId('sys_integration', 'kingdee');
		yield* t.db.write({
			text: `UPDATE sys_integration
				SET status = '{"health":{"state":"attention","code":"windowLag"}}'::jsonb,
					revision = revision + 1
				WHERE id = $1`,
			params: [instance]
		});
		t.member([], { teams: ['configurators'], email: 'configuration@test.example' });
		t.clock.set('2026-10-10T00:05:00.000Z');
		yield* t.runDue();
		const notices = yield* t.db.rows(
			Schema.Struct({ title: Schema.String, body: Schema.NullOr(Schema.String) }),
			{
				text: 'SELECT title, body FROM sys_notification ORDER BY at',
				params: []
			}
		);
		expect(notices).toMatchObject([
			{
				title: 'kingdee needs attention',
				body: 'An accounting source window is taking longer than the configured limit.'
			}
		]);
	})
);
