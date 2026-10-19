import { fixtureId, decimalText } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema, Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { configuredCommission } from './commission-kit.js';
import { committed, confirm, draft, PRODUCT } from './kit.js';
test.live(
	'sales plus logistics sees foreign quantities but cannot calculate foreign sealed commission',
	() =>
		Effect.gen(function* () {
			const { t, as, own } = yield* configuredCommission();
			const mixed = t.member(['sales', 'logistics']);
			const actor = t.as(mixed);
			expect(yield* actor.get('orders', own.order)).toMatchObject({
				sealed_snapshot: { $masked: true }
			});
			expect(yield* actor.query('orders.commission', {})).toEqual([]);
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(actor.query('orders.sealed_export', { order: own.order }))
					).rejects.toThrow('errors.agreement_access'),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(actor.query('orders.confirmation_check', { order: own.order }))
					).rejects.toThrow('errors.commercial_access'),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const personal = yield* draft(t, 'sales', fixtureId('sys_user', mixed.id));
			committed('order_lines', yield* as.act('order_lines.delete', { target: personal.line }));
			committed(
				'orders',
				yield* as.act('orders.update', {
					target: personal.order,
					set: { warehouse: fixtureId('warehouses', '00000000-0000-4000-8000-000000000301') }
				})
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.create', {
					order: personal.order,
					product: PRODUCT,
					quantity: Decimal.of('10'),
					unit_price: Decimal.of('2'),
					discount_pct: Decimal.of('0'),
					tax_rate: Decimal.of('9')
				})
			);
			yield* confirm(t, personal.order);
			expect(yield* actor.query('orders.sealed_export', { order: personal.order })).toMatchObject({
				contract: expect.any(String)
			});
			expect(yield* actor.query('orders.commission', {})).toMatchObject([
				{ order: personal.order, amount: decimalText('2.10') }
			]);
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
