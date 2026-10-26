import { Instant } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { draft, workspace } from './kit.js';

it.live('the confirmation query and write agree on the sealed hash basis', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const own = yield* draft(t);
		const as = t.as(t.admin);
		const check = yield* as.query('orders.confirmation_check', {
			as_of: Instant(t.clock.now()),
			order: own.order
		});
		expect(
			yield* as.act('orders.update', {
				target: own.order,
				set: { status: 'confirmed', check_hash: check.check_hash }
			})
		).toMatchObject({ kind: 'committed' });
		expect(yield* as.query('orders', { id: own.order })).toMatchObject({ status: 'confirmed' });
	})
);
