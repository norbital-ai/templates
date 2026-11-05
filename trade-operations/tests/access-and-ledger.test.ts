import { Instant } from '@norbital-ai/std/date';
import { fixtureId, decimalText } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema, Effect } from 'effect';
import { expect, layer } from '@effect/vitest';
import { direct } from './synced-kit.js';
import { commissionRule, WEST } from './commission-kit.js';
import { Trade, shared, draft, confirm } from './kit.js';
import { commissionOf, confirmationOf, sealedExportOf } from './reads.js';
const rejects = (effect: Effect.Effect<unknown, unknown>, message?: string) =>
	Effect.tryPromise({
		try: () => expect(Effect.runPromise(effect)).rejects.toThrow(message),
		catch: (cause) => new TestIoFailed({ message: String(cause) })
	});
layer(shared(), { excludeTestServices: true })('access and ledger', (test) => {
	test.effect(
		'sales is scoped through every child and configuration never grants commercial rows',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const sales = t.member(['sales']);
				const as = t.as(sales);
				const mine = yield* draft(t, 'sales', fixtureId('sys_user', sales.id));
				const other = yield* draft(t);
				expect((yield* as.query({ orders: {} })).orders.rows.map((r) => r.id)).toEqual([
					mine.order
				]);
				expect((yield* as.query({ order_lines: {} })).order_lines.rows.map((r) => r.id)).toEqual([
					mine.line
				]);
				expect(
					yield* Effect.flip(
						as.act('order_lines.update', [
							{ target: other.line, set: { unit_price: Decimal.of('1') } }
						])
					)
				).toMatchObject({ _tag: 'ActRefused' });
				expect(
					yield* Effect.flip(
						as.act('activities.create', [{ order: other.order, title: 'Sneak in', kind: 'note' }])
					)
				).toMatchObject({ _tag: 'ActRefused' });
				yield* rejects(confirmationOf(as, { as_of: Instant(t.clock.now()), order: other.order }));
				yield* rejects(t.as(t.member(['configuration'])).query({ orders: {} }));
				expect(
					yield* direct(t, as.authority, {
						model: 'products',
						verb: 'update',
						input: [
							{
								target: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
								set: { name: 'Overwrite ERP' }
							}
						]
					})
				).not.toMatchObject({ kind: 'committed' });
			})
	);
	test.effect(
		'logistics reads quantities through its output but not prices; with sales it cannot calculate foreign sealed commission',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				yield* commissionRule(t);
				const foreign = yield* draft(t, 'sales', undefined, undefined, WEST);
				yield* confirm(t, foreign.order);
				const logistics = t.as(t.member(['logistics']));
				const line = (yield* logistics.query({
					order_lines: { output: 'logistics', where: { id: { eq: foreign.line } }, limit: 1 }
				})).order_lines.rows[0];
				expect(line?.quantity.eq(10)).toBe(true);
				expect(line).not.toHaveProperty('unit_price');
				yield* rejects(logistics.query({ order_lines: {} }));
				expect(
					yield* direct(t, logistics.authority, {
						model: 'transactions',
						verb: 'create',
						input: [{ order: foreign.order }]
					})
				).not.toMatchObject({ kind: 'committed' });
				const mixed = t.member(['sales', 'logistics']);
				const actor = t.as(mixed);
				// sales' default output admits only its own orders; the logistics output carries no terms
				expect(
					(yield* actor.query({ orders: { where: { id: { eq: foreign.order } } } })).orders.rows
				).toEqual([]);
				const shipped = (yield* actor.query({
					orders: { output: 'logistics', where: { id: { eq: foreign.order } }, limit: 1 }
				})).orders.rows[0];
				expect(shipped).toMatchObject({ id: foreign.order, status: 'confirmed' });
				expect(shipped).not.toHaveProperty('sealed_snapshot');
				expect(shipped).not.toHaveProperty('sealed_contract');
				yield* rejects(
					sealedExportOf(actor, { order: foreign.order }),
					'errors.order_not_confirmed'
				);
				yield* rejects(
					confirmationOf(actor, { as_of: Instant(t.clock.now()), order: foreign.order })
				);
				const personal = yield* draft(t, 'sales', fixtureId('sys_user', mixed.id), undefined, WEST);
				yield* confirm(t, personal.order);
				expect(yield* commissionOf(actor, {})).toMatchObject([
					{ order: personal.order, amount: decimalText('2.10') }
				]);
			})
	);
});
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
