import { Effect } from 'effect';
import { expect, it as test, layer } from '@effect/vitest';

import { averageLotCost, estimateFifoCost } from '../src/lib/lot-cost.js';
import { fixtureId, sameDecimal } from './test-runtime.js';
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
						as_of: '2026-10-12T00:00:00Z'
					}
				]);
				const as = yield* t.as(t.member(['configuration']));
				const input = {
					product: PRODUCT,
					unit: 'kg',
					currency: 'SGD',
					price: '1.60',
					tax_inclusive: true,
					tax_rate: '9'
				} satisfies Parameters<typeof inventoryCostOf>[1];
				expect(yield* inventoryCostOf(as, input)).toMatchObject({ below: true });
				expect(yield* inventoryCostOf(as, { ...input, price: '1.635' })).toMatchObject({
					below: false
				});
				expect(yield* inventoryCostOf(as, { ...input, unit: '吨', price: '1600' })).toMatchObject({
					below: true
				});
				expect(yield* inventoryCostOf(as, { ...input, unit: '吨', price: '1635' })).toMatchObject({
					below: false
				});
				expect(yield* inventoryCostOf(as, { ...input, currency: 'USD' })).toMatchObject({
					below: false,
					average: null
				});
			})
	);
});
test('average inventory cost weights remaining lots and converts compatible mass units', () => {
	const base = { product: 'resin', unit: 'kg', currency: 'SGD', on_hand: '10', unit_cost: '2' };
	const rows = [
		base,
		{ ...base, on_hand: '30', unit_cost: '4' },
		{ ...base, on_hand: '0', unit_cost: '99' },
		{ ...base, currency: 'USD', unit_cost: '99' }
	];
	expect(sameDecimal(averageLotCost(rows, 'resin', 'kg', 'SGD'), '3.5')).toBe(true);
	expect(sameDecimal(averageLotCost(rows, 'resin', '吨', 'SGD'), '3500')).toBe(true);
	expect(averageLotCost([...rows, { ...base, unit_cost: null }], 'resin', 'kg', 'SGD')).toBeNull();
	expect(averageLotCost(rows, 'resin', 'box', 'SGD')).toBeNull();
	expect(averageLotCost([...rows, { ...base, unit: null }], 'resin', 'kg', 'SGD')).toBeNull();
});

test('FIFO lot cost converts kg stock and receipt lots into tonne requests', () => {
	const result = estimateFifoCost(
		[
			{
				product: 'resin',
				source: 'kingdee',
				warehouse: 'wh-1',
				lot_number: 'LOT-1',
				unit: 'KG',
				on_hand: '2000'
			}
		],
		{
			id: fixtureId('source_lot_costs', '019b76dc-0000-7000-8000-000000000001'),
			currency: 'CNY',
			observed_at: '2026-11-22T08:00:00Z',
			entries: [
				{
					product_code: '4912',
					lot_number: 'LOT-1',
					unit: 'KG',
					received_qty: '5000',
					unit_cost: '12.5',
					received_on: '2026-11-01'
				}
			]
		},
		{
			product: 'resin',
			productCode: '4912',
			source: 'kingdee',
			warehouses: ['wh-1'],
			quantity: '1.5',
			unit: '吨',
			currency: 'CNY',
			as_of: '2026-11-22T08:10:00Z',
			confirmed: { stock: '2026-11-22T08:05:00Z', lots: '2026-11-22T08:05:00Z' }
		}
	);
	expect(result).not.toBeNull();
	expect(sameDecimal(result?.unit_cost, '12500')).toBe(true);
	expect(sameDecimal(result?.total, '18750')).toBe(true);
});
