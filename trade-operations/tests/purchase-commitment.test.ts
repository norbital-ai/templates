import { JobResult } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { agreements, currentAgreement } from '../src/lib/agreements.js';
import { committed, draft, workspace } from './kit.js';
import { confirmationOf } from './reads.js';
import { firstRow, fixtureId } from './test-runtime.js';

it.live('procurement can record and revise a local commitment without Kingdee', () =>
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
				.pipe(Effect.map((answer) => answer.orders.rows));
		const seal = Effect.gen(function* () {
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
		});
		yield* seal;
		yield* t.deliver();
		const before = firstRow(yield* record());
		const original = currentAgreement(before);
		expect(original?.snapshot.lines[0]?.quantity).toMatch(/^10(?:\.0+)?$/);
		const run = yield* as.run(
			'orders_revise',
			{ orders: [order], revision: before.revision },
			JobResult
		);
		if (run.kind !== 'committed') throw new Error('Revision must start');
		yield* t.run_due();
		expect(
			yield* t.db.rows(Schema.Struct({ state: Schema.String, error: Schema.NullOr(Schema.Json) }), {
				text: 'SELECT state, error FROM sys_run WHERE id = $1',
				params: [run.output.id]
			})
		).toEqual([{ state: 'succeeded', error: null }]);
		const draftRecord = firstRow(yield* record());
		expect(draftRecord.status).toBe('draft');
		expect(currentAgreement(draftRecord)).toEqual(original);
		yield* as.act({
			'order_lines.update': [{ target: yield* t.at('order_lines', line), set: { quantity: '7' } }]
		});
		yield* seal;
		yield* t.deliver();
		const after = firstRow(yield* record());
		expect(currentAgreement(after)).toMatchObject({ version: 2, lifecycle: 'current' });
		expect(currentAgreement(after)?.snapshot.lines[0]?.quantity).toMatch(/^7(?:\.0+)?$/);
		expect(agreements(after)[0]).toEqual({ ...original, lifecycle: 'superseded' });
		yield* as.act({
			'orders.update': [{ target: yield* t.at('orders', order), set: { archived: true } }]
		});
		expect(firstRow(yield* record()).archived).toBe(true);
	})
);
