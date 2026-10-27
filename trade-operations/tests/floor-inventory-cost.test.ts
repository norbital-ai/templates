import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace, PRODUCT } from './kit.js';
import { businessRows } from './business-source.js';
import { inventoryCostOf } from './reads.js';
test.live(
	'floor warning compares remaining lot cost in matching units and currency, excluding tax',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
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
			expect(yield* inventoryCostOf(as, input)).toMatchObject({
				below: true
			});
			expect(
				yield* inventoryCostOf(as, {
					...input,
					price: Decimal.of('1.60'),
					tax_rate: Decimal.of('9')
				})
			).toMatchObject({ below: true });
			expect(yield* inventoryCostOf(as, { ...input, price: Decimal.of('1.635') })).toMatchObject({
				below: false
			});
			expect(yield* inventoryCostOf(as, { ...input, currency: 'USD' })).toMatchObject({
				below: false,
				average: null
			});
		})
);
