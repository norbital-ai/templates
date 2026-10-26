import { decimalText } from './test-runtime.js';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema, Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import {
	commissionContext,
	evaluateCommission,
	DEFAULT_COMMISSION_EXPRESSION
} from '../src/lib/commission-expressions.js';
import { configuredCommission } from './commission-kit.js';
import { committed, confirm, draft, workspace } from './kit.js';
const context = (over: Partial<Parameters<typeof commissionContext>[0]> = {}) =>
	commissionContext({
		quantity: '1000',
		net: '2000',
		floor_net: '1',
		factor: '0.001',
		product_code: 'SKU-1',
		product_name: 'Steel',
		unit: 'kg',
		currency: 'SGD',
		ordered_on: '2026-10-10',
		party_code: 'C1',
		fixed_rate: '10',
		spread_pct: '20',
		parameters: [],
		...over
	});
test('CEL decimals configure tiers, eligibility, caps and exact large monetary values', () => {
	expect(
		evaluateCommission('true', DEFAULT_COMMISSION_EXPRESSION, context()).amount.round(2).toString()
	).toBe('210.00');
	expect(
		evaluateCommission(
			'quantity >= 1000 && product.code == "SKU-1"',
			'min(net * params.rate, params.cap)',
			context({
				parameters: [
					{ name: 'rate', value: '0.15' },
					{ name: 'cap', value: '250' }
				]
			})
		)
			.amount.round(2)
			.toString()
	).toBe('250.00');
	expect(evaluateCommission('quantity > 1000', 'net * decimal("0.05")', context())).toMatchObject({
		eligible: false
	});
	expect(
		evaluateCommission(
			'true',
			'net >= 2000 ? net * decimal("0.1") : net * decimal("0.05")',
			context({ floor_net: null, factor: null })
		)
			.amount.round(2)
			.toString()
	).toBe('200.00');
	expect(
		evaluateCommission('true', 'net + decimal("0.01")', context({ net: '9007199254740993.12' }))
			.amount.round(2)
			.toString()
	).toBe('9007199254740993.13');
	for (const source of ['net / 0', '"not money"', 'unknown_fact * 2'])
		expect(() => evaluateCommission('true', source, context())).toThrow();
	expect(() => evaluateCommission('net', 'net', context())).toThrow();
});
test.live(
	'configured expressions and parameters seal per SO; later rules cannot rewrite prior commission',
	() =>
		Effect.gen(function* () {
			const { t, as, own, rule } = yield* configuredCommission({ confirmOrder: false });
			committed(
				'commission_rules',
				yield* as.act('commission_rules.update', {
					target: rule,
					set: {
						amount_expression: 'min(net * params.rate, params.cap)',
						eligibility_expression: 'product.unit == "kg"',
						parameters: [
							{ name: 'rate', value: '0.15' },
							{ name: 'cap', value: '250' }
						]
					}
				})
			);
			const configuration = t.as(t.member(['configuration']));
			expect(
				yield* configuration.query('commission_rules.preview', {
					rule,
					quantity: Decimal.of('1000'),
					net: Decimal.of('2000'),
					unit: 'kg',
					ordered_on: PlainDate('2026-10-10')
				})
			).toMatchObject({ currency: 'SGD', amount: decimalText('250.00'), reason: 'resolved' });
			expect(
				yield* configuration.query('commission_rules.preview', {
					rule,
					quantity: Decimal.of('1000'),
					net: Decimal.of('2000'),
					unit: 'piece',
					ordered_on: PlainDate('2026-10-10')
				})
			).toMatchObject({ amount: decimalText('0.00'), reason: 'ineligible' });
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(
							t.as(t.member(['sales'])).query('commission_rules.preview', {
								rule,
								quantity: Decimal.of('1000'),
								net: Decimal.of('2000'),
								ordered_on: PlainDate('2026-10-10')
							})
						)
					).rejects.toThrow(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			yield* confirm(t, own.order);
			const sealed = yield* as.query('orders', { id: own.order });
			expect(sealed?.sealed_commission).toMatchObject({
				engine_version: 'cel-decimal-v1',
				amount_expression: 'min(net * params.rate, params.cap)',
				parameters: [
					{ name: 'rate', value: '0.15' },
					{ name: 'cap', value: '250' }
				]
			});
			const f = t.as(t.member(['finance']));
			expect(yield* f.query('orders.commission', {})).toMatchObject([
				{ order: own.order, amount: decimalText('250.00') }
			]);
			committed(
				'commission_rules',
				yield* as.act('commission_rules.update', {
					target: rule,
					set: { amount_expression: 'net', parameters: [] }
				})
			);
			expect(yield* f.query('orders.commission', {})).toMatchObject([
				{ order: own.order, amount: decimalText('250.00') }
			]);
			expect(yield* as.query('orders', { id: own.order })).toEqual(sealed);
			expect(
				yield* Effect.flip(
					as.act('commission_rules.update', { target: rule, set: { amount_expression: 'net * (' } })
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* Effect.flip(
					as.act('commission_rules.update', {
						target: rule,
						set: {
							parameters: [
								{ name: 'rate', value: '0.1' },
								{ name: 'rate', value: '0.2' }
							]
						}
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
);
test.live(
	'a net percentage rule works on a sealed SO without optional floor or conversion facts',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			committed(
				'commission_rules',
				yield* as.act('commission_rules.create', {
					currency: 'SGD',
					effective_on: PlainDate('2026-10-10'),
					eligibility_expression: 'true',
					amount_expression: 'net * decimal("0.05")',
					parameters: [],
					fixed_rate: Decimal.of('0'),
					spread_pct: Decimal.of('0'),
					active: true
				})
			);
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			expect(yield* as.query('orders.commission', {})).toMatchObject([
				{ order: own.order, amount: decimalText('1.00') }
			]);
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
