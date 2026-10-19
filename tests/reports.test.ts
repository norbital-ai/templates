import { fixtureId, decimalText } from './test-runtime.js';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { sourceOrder, sourceTransaction, sourcePayment } from './synced-kit.js';
import { expect, it as test } from '@effect/vitest';
import { committed, workspace, draft, confirm, PRODUCT } from './kit.js';
test.live(
	'AR separates applied payments, unapplied deposits, overdue buckets and overpayments',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const { order, line } = yield* draft(t);
			yield* confirm(t, order);
			const as = t.as(t.admin);
			const parent = yield* sourceOrder(t, order);
			const invoice = yield* sourceTransaction(t, { order, line }, parent);
			yield* sourcePayment(t, parent, invoice.id, '5');
			yield* sourcePayment(t, parent, null, '3');
			expect(yield* as.query('orders.ar_aging', { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ balance: decimalText('16.80'), bucket: '61_90', overpaid: decimalText('0') }
			]);
			yield* sourcePayment(t, parent, invoice.id, '20');
			expect(yield* as.query('orders.ar_aging', { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ balance: decimalText('0'), overpaid: decimalText('3.20') }
			]);
		})
);
test.live(
	'commission keeps its SO-sealed floor, rule and conversion when configuration changes',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const rule = committed(
				'commission_rules',
				yield* as.act('commission_rules.create', {
					code: 'default',
					currency: 'SGD',
					effective_on: PlainDate('2026-01-01'),
					basis_unit: 't',
					fixed_rate: Decimal.of('10'),
					spread_pct: Decimal.of('20')
				})
			);
			const floor = committed(
				'pricing_floors',
				yield* as.act('pricing_floors.create', {
					product: PRODUCT,
					currency: 'SGD',
					group_code: 'WEST',
					effective_on: PlainDate('2026-01-01'),
					unit: 'kg',
					floor_price: Decimal.of('1'),
					tax_inclusive: false
				})
			);
			const { order, line } = yield* draft(t);
			committed('order_lines', yield* as.act('order_lines.delete', { target: line }));
			committed(
				'orders',
				yield* as.act('orders.update', {
					target: order,
					set: { warehouse: fixtureId('warehouses', '00000000-0000-4000-8000-000000000301') }
				})
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.create', {
					order,
					product: PRODUCT,
					quantity: Decimal.of('1000'),
					unit_price: Decimal.of('2'),
					discount_pct: Decimal.of('0'),
					tax_rate: Decimal.of('9')
				})
			);
			yield* confirm(t, order);
			const before = yield* as.query('orders.commission', {});
			expect(before).toMatchObject([
				{ reason: 'resolved', amount: decimalText('210.00'), spread: decimalText('1000.00000000') }
			]);
			committed(
				'commission_rules',
				yield* as.act('commission_rules.update', {
					target: rule,
					set: { fixed_rate: Decimal.of('500'), spread_pct: Decimal.of('90') }
				})
			);
			committed(
				'pricing_floors',
				yield* as.act('pricing_floors.update', {
					target: floor,
					set: { floor_price: Decimal.of('100') }
				})
			);
			expect(yield* as.query('orders.commission', {})).toEqual(before);
		})
);
