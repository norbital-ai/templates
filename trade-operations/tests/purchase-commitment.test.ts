import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { committed, draft, workspace } from './kit.js';
import { confirmationOf } from './reads.js';
import { firstRow, fixtureId, sameDecimal } from './test-runtime.js';

it.live('procurement records and changes a local commitment directly, without Kingdee', () =>
	Effect.gen(function* () {
		const t = yield* workspace({
			source: () => Effect.die('A purchase commitment must never call Kingdee')
		});
		const buyer = t.member(['procurement'], { teams: ['procurement'] });
		const as = yield* t.as(buyer);
		const { order, line } = yield* draft(t, 'purchasing', fixtureId('sys_user', buyer.id));
		const record = () =>
			as
				.query({ orders: { where: { id: { eq: order } }, limit: 1 } })
				.pipe(Effect.map((answer) => firstRow(answer.orders.rows)));
		const check = yield* confirmationOf(as, { order, as_of: t.clock.now() });
		committed(
			'orders',
			yield* as.act({
				'orders.update': [
					{
						target: yield* t.at('orders', order),
						set: { status: 'confirmed', check_hash: check.check_hash }
					}
				]
			})
		);
		yield* t.deliver();
		expect((yield* record()).status).toBe('confirmed');
		committed(
			'order_lines',
			yield* as.act({
				'order_lines.update': [{ target: yield* t.at('order_lines', line), set: { quantity: '7' } }]
			})
		);
		yield* t.deliver();
		const after = yield* record();
		expect(after.status).toBe('confirmed');
		expect(sameDecimal(after.total, '15.26')).toBe(true);
		committed(
			'orders',
			yield* as.act({
				'orders.update': [{ target: yield* t.at('orders', order), set: { archived: true } }]
			})
		);
		expect((yield* record()).archived).toBe(true);
	})
);
