import type { Row } from '@norbital-ai/bolt';
import { decimalText } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { committed, CUSTOMER, SUPPLIER, PRODUCT, workspace } from './kit.js';
test.live(
	'sales uses product defaults, explicit zero tax is retained, and purchasing requires cost',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const make = (
				direction: 'sales' | 'purchasing',
				currency: Row<'orders'>['currency'] = 'SGD'
			) =>
				as.act('orders.create', {
					title: 'Catalog defaults',
					direction,
					party: direction === 'sales' ? CUSTOMER : SUPPLIER,
					currency,
					payment_terms: 'Net 30'
				});
			const order = committed('orders', yield* make('sales'));
			const line = committed(
				'order_lines',
				yield* as.act('order_lines.create', { order, product: PRODUCT, quantity: Decimal.of('10') })
			);
			expect(yield* as.query('order_lines', { id: line })).toMatchObject({
				unit_price: decimalText('2.0000'),
				tax_rate: decimalText('9'),
				total: decimalText('21.80')
			});
			const zero = committed(
				'order_lines',
				yield* as.act('order_lines.create', {
					order,
					product: PRODUCT,
					quantity: Decimal.of('1'),
					tax_rate: Decimal.of('0')
				})
			);
			expect(yield* as.query('order_lines', { id: zero })).toMatchObject({
				tax_rate: decimalText('0'),
				total: decimalText('2.00')
			});
			const purchase = committed('orders', yield* make('purchasing'));
			expect(
				yield* Effect.flip(
					as.act('order_lines.create', {
						order: purchase,
						product: PRODUCT,
						quantity: Decimal.of('1')
					})
				)
			).toMatchObject({ _tag: 'ActRefused', message: 'errors.price_required' });
			const cost = committed(
				'order_lines',
				yield* as.act('order_lines.create', {
					order: purchase,
					product: PRODUCT,
					quantity: Decimal.of('1'),
					unit_price: Decimal.of('1.25')
				})
			);
			expect(yield* as.query('order_lines', { id: cost })).toMatchObject({
				unit_price: decimalText('1.25'),
				tax_rate: decimalText('9')
			});
			const usd = committed('orders', yield* make('sales', 'USD'));
			expect(
				yield* Effect.flip(
					as.act('order_lines.create', { order: usd, product: PRODUCT, quantity: Decimal.of('1') })
				)
			).toMatchObject({ _tag: 'ActRefused', message: 'errors.currency_price' });
		})
);
