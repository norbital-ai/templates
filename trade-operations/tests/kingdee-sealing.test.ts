import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { committed, confirm, workspace } from './kit.js';
import { kingdeeDraft, kingdeeFixture } from './kingdee-fixture.js';

it.live(
	'a draft remains local until its contract is sealed, and archiving does not drop its queued submission',
	() =>
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const as = t.as(t.admin);
			const own = yield* kingdeeDraft(t, fixture);
			yield* t.deliver();
			expect(fixture.submissions.size).toBe(0);
			yield* confirm(t, own.order);
			expect(
				(yield* as.query({ ext_sales_orders: { where: { order: { eq: own.order } } } }))
					.ext_sales_orders.rows
			).toEqual([]);
			committed(
				'orders',
				yield* as.act('orders.update', [{ target: own.order, set: { archived: true } }])
			);
			yield* t.deliver();
			expect(fixture.submissions.size).toBe(1);
		})
);
