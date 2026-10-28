import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { expect, it as test, layer } from '@effect/vitest';

import { averageLotCost } from '../src/lib/lot-cost.js';
import { shared, Trade, PRODUCT } from './kit.js';
import { businessRows } from './business-source.js';
import { inventoryCostOf } from './reads.js';
layer(shared(), { excludeTestServices: true })('stock on a workspace', (it) => {
	it.effect(
		'floor warning compares remaining lot cost in matching units and currency, excluding tax',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				yield* businessRows(t, 'stock_snapshots', [
					{
						external_code: 'floor-cost-lot',
						product_code: 'RESIN-A',
						warehouse_code: 'WEST',
						lot_number: 'WARN-LOT',
						currency: 'SGD',
						unit: 'kg',
						on_hand: '10',
						unit_cost: '1.5',
						erp_committed: '0',
						as_of: '2026-10-12T00:00:00Z',
						orders_as_of: '2026-10-12T00:00:00Z'
					}
				]);
				const as = t.as(t.member(['configuration']));
				const input = {
					product: PRODUCT,
					unit: 'kg',
					currency: 'SGD',
					price: Decimal.of('1.60'),
					tax_inclusive: true,
					tax_rate: Decimal.of('9')
				} satisfies Parameters<typeof inventoryCostOf>[1];
				expect(yield* inventoryCostOf(as, input)).toMatchObject({ below: true });
				expect(yield* inventoryCostOf(as, { ...input, price: Decimal.of('1.635') })).toMatchObject({
					below: false
				});
				expect(yield* inventoryCostOf(as, { ...input, currency: 'USD' })).toMatchObject({
					below: false,
					average: null
				});
			})
	);
});
test('average inventory cost weights remaining lots and leaves incomplete cost evidence unknown', () => {
	const base = { product: 'resin', unit: 'kg', currency: 'SGD', on_hand: '10', unit_cost: '2' };
	const rows = [
		base,
		{ ...base, on_hand: '30', unit_cost: '4' },
		{ ...base, on_hand: '0', unit_cost: '99' },
		{ ...base, currency: 'USD', unit_cost: '99' }
	];
	expect(averageLotCost(rows, 'resin', 'kg', 'SGD')?.toString()).toBe('3.50000000');
	expect(averageLotCost([...rows, { ...base, unit_cost: null }], 'resin', 'kg', 'SGD')).toBeNull();
	expect(averageLotCost(rows, 'resin', 'box', 'SGD')).toBeNull();
	expect(averageLotCost([...rows, { ...base, unit: null }], 'resin', 'kg', 'SGD')).toBeNull();
});
