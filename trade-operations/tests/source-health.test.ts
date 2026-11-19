import { Effect, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { workspace } from './kit.js';

it.live('a ledger turning to attention notifies the workspace administrator only, once', () =>
	Effect.gen(function* () {
		const t = yield* workspace({
			source: () => Effect.fail(new FacilityFailure({ kind: 'invalid', message: 'Login failed.' }))
		});
		const admin = t.admin.actor;
		if (admin.kind !== 'member') throw new Error('A workspace administrator is required');
		t.member([], { teams: ['configurators'], email: 'configuration@test.example' });
		const notices = t.db.rows(Schema.Struct({ member: Schema.String, title: Schema.String }), {
			text: 'SELECT member, title FROM sys_notification ORDER BY at',
			params: []
		});
		// the read's failure moves the connection's health; that update, not a sweep, queues the notice
		for (const _ of [1, 2]) {
			yield* Effect.ignore(t.pull('products'));
			yield* t.run_due();
		}
		expect(yield* notices).toEqual([{ member: admin.id, title: 'kingdee needs attention' }]);
	})
);
