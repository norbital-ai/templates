import { decimalText } from './test-runtime.js';
import { BigDecimal, Effect } from 'effect';
import { expect, it as test, layer } from '@effect/vitest';
import {
	commissionContext,
	commissionFault,
	evaluateCommission,
	DEFAULT_COMMISSION_EXPRESSION
} from '../src/lib/commission-expressions.js';
import { commissionRule, commissionSale } from './commission-kit.js';
import { Trade, committed, confirm, draft, shared } from './kit.js';
import { commissionOf, previewOf } from './reads.js';
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
const cents = (amount: BigDecimal.BigDecimal) =>
	BigDecimal.format(BigDecimal.round(amount, { scale: 2, mode: 'half-from-zero' }));
test('CEL decimals configure tiers, eligibility, caps and exact large monetary values', () => {
	expect(cents(evaluateCommission('true', DEFAULT_COMMISSION_EXPRESSION, context()).amount)).toBe(
		'210'
	);
	expect(
		cents(
			evaluateCommission(
				'quantity >= 1000 && product.code == "SKU-1"',
				'min(net * params.rate, params.cap)',
				context({
					parameters: [
						{ name: 'rate', value: '0.15' },
						{ name: 'cap', value: '250' }
					]
				})
			).amount
		)
	).toBe('250');
	expect(evaluateCommission('quantity > 1000', 'net * decimal("0.05")', context())).toMatchObject({
		eligible: false
	});
	expect(
		cents(
			evaluateCommission(
				'true',
				'net >= 2000 ? net * decimal("0.1") : net * decimal("0.05")',
				context({ floor_net: null, factor: null })
			).amount
		)
	).toBe('200');
	expect(
		cents(
			evaluateCommission('true', 'net + decimal("0.01")', context({ net: '9007199254740993.12' }))
				.amount
		)
	).toBe('9007199254740993.13');
	for (const source of ['net / 0', '"not money"', 'unknown_fact * 2'])
		expect(() => evaluateCommission('true', source, context())).toThrow();
	expect(() => evaluateCommission('net', 'net', context())).toThrow();
});
layer(shared(), { excludeTestServices: true })('configured commission', (test) => {
	test.effect(
		'configured expressions and parameters stay with each confirmed SO; later rules cannot rewrite its commission',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const as = yield* t.as(t.admin);
				const { rule } = yield* commissionRule(t);
				const { own } = yield* commissionSale(t, false);
				committed(
					'commission_rules',
					yield* as.act({
						'commission_rules.update': [
							{
								target: yield* t.at('commission_rules', rule),
								set: {
									amount_expression: 'min(net * params.rate, params.cap)',
									eligibility_expression: 'product.unit == "kg"',
									parameters: [
										{ name: 'rate', value: '0.15' },
										{ name: 'cap', value: '250' }
									]
								}
							}
						]
					})
				);
				const configuration = yield* t.as(t.member(['configuration']));
				expect(
					yield* previewOf(configuration, {
						rule,
						quantity: '1000',
						net: '2000',
						unit: 'kg',
						ordered_on: '2026-10-10'
					})
				).toMatchObject({ currency: 'SGD', amount: decimalText('250.00'), reason: 'resolved' });
				expect(
					yield* previewOf(configuration, {
						rule,
						quantity: '1000',
						net: '2000',
						unit: 'piece',
						ordered_on: '2026-10-10'
					})
				).toMatchObject({ amount: decimalText('0.00'), reason: 'ineligible' });
				// a preview is computed from the rule the caller already reads: no authority beyond `commission_rules.read`
				expect(
					yield* previewOf(yield* t.as(t.member(['sales'])), {
						rule,
						quantity: '1000',
						net: '2000',
						ordered_on: '2026-10-10'
					})
				).toMatchObject({ currency: 'SGD' });
				yield* confirm(t, own.order);
				const confirmed = (yield* as.query({
					orders: { where: { id: { eq: own.order } }, limit: 1 }
				})).orders.rows[0];
				expect(confirmed?.commission).toMatchObject({
					engine_version: 'cel-decimal-v1',
					amount_expression: 'min(net * params.rate, params.cap)',
					parameters: [
						{ name: 'rate', value: '0.15' },
						{ name: 'cap', value: '250' }
					]
				});
				const f = yield* t.as(t.member(['finance']));
				expect(yield* commissionOf(f, {})).toMatchObject([
					{ order: own.order, amount: decimalText('250.00') }
				]);
				committed(
					'commission_rules',
					yield* as.act({
						'commission_rules.update': [
							{
								target: yield* t.at('commission_rules', rule),
								set: { amount_expression: 'net', parameters: [] }
							}
						]
					})
				);
				expect(yield* commissionOf(f, {})).toMatchObject([
					{ order: own.order, amount: decimalText('250.00') }
				]);
				expect(
					(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders
						.rows[0]
				).toEqual(confirmed);
				expect(
					yield* Effect.flip(
						as.act({
							'commission_rules.update': [
								{
									target: yield* t.at('commission_rules', rule),
									set: { amount_expression: 'net * (' }
								}
							]
						})
					)
				).toMatchObject({ _tag: 'ActRefused' });
				expect(
					yield* Effect.flip(
						as.act({
							'commission_rules.update': [
								{
									target: yield* t.at('commission_rules', rule),
									set: {
										parameters: [
											{ name: 'rate', value: '0.1' },
											{ name: 'rate', value: '0.2' }
										]
									}
								}
							]
						})
					)
				).toMatchObject({ _tag: 'ActRefused' });
			})
	);
	test.effect(
		'a net percentage rule works on a confirmed SO without optional floor or conversion facts',
		() =>
			Effect.gen(function* () {
				// runs after the configured rule: this later-effective rule applies to the new SO only
				const t = yield* Trade;
				const as = yield* t.as(t.admin);
				committed(
					'commission_rules',
					yield* as.act({
						'commission_rules.create': [
							{
								currency: 'SGD',
								effective_on: '2026-10-10',
								eligibility_expression: 'true',
								amount_expression: 'net * decimal("0.05")',
								parameters: [],
								fixed_rate: '0',
								spread_pct: '0',
								active: true
							}
						]
					})
				);
				const own = yield* draft(t);
				yield* confirm(t, own.order);
				expect(yield* commissionOf(as, { order: own.order })).toMatchObject([
					{ order: own.order, amount: decimalText('1.00') }
				]);
			})
	);
});

test('checks commission member paths against the declared formula roots', () => {
	expect(commissionFault('product.code == "SKU-1"', 'bool')).toBeUndefined();
	expect(commissionFault('product.cost > 0', 'bool')).toContain('product.cost');
	expect(commissionFault('rule.fixed_rate * basis_quantity', 'money')).toBeUndefined();
});
