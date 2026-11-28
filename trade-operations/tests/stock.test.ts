import { Effect } from 'effect';
import { expect, it as test, layer } from '@effect/vitest';

import { averageLotCost, estimateFifoCost } from '../src/lib/lot-cost.js';
import { quotationCostRead, quotationFifoCosts, quotationScopeRead } from '../src/lib/quotation.js';
import { stockAvailability, stockAvailabilityRead } from '../src/lib/stock-availability.js';
import { firstRow, fixtureId, sameDecimal } from './test-runtime.js';
import { committed, draft, shared, Trade, PRODUCT } from './kit.js';
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

layer(shared(), { excludeTestServices: true })('stock availability per-region units', (it) => {
	it.effect(
		'stockAvailability computes unit compatibility per region and preserves product unit on zero-lot regions',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const as = yield* t.as(t.admin);
				yield* businessRows(t, 'warehouses', [
					{
						external_code: 'EAST-REG',
						source_number: 'WH-EAST',
						name: 'East WH',
						group_code: 'EAST',
						active: true,
						source_updated_at: '2026-11-22T08:00:00Z'
					},
					{
						external_code: 'WEST-REG',
						source_number: 'WH-WEST',
						name: 'West WH',
						group_code: 'WEST-ONLY',
						active: true,
						source_updated_at: '2026-11-22T08:00:00Z'
					}
				]);
				yield* businessRows(t, 'stock_snapshots', [
					{
						external_code: 'east-lot-1',
						product_code: 'RESIN-A',
						warehouse_code: 'EAST-REG',
						lot_number: 'LOT-E',
						currency: 'SGD',
						unit: 'kg',
						on_hand: '100',
						unit_cost: '2',
						as_of: '2026-11-22T08:05:00Z'
					}
				]);
				const whs = (yield* as.query({
					warehouses: { where: { external_code: { in: ['EAST-REG', 'WEST-REG'] } } }
				})).warehouses.rows;
				const whEast = whs.find((w) => w.external_code === 'EAST-REG');
				const whWest = whs.find((w) => w.external_code === 'WEST-REG');
				if (!whEast || !whWest) throw new Error('Expected test warehouses');
				yield* t.syncs.write('source_stock_commitments.sync.kingdee', [
					{
						$id: 'commitments',
						source: 'kingdee',
						observed_at: '2026-11-22T08:05:00Z',
						entries: [
							{
								product_code: 'RESIN-A',
								warehouse: whEast.id,
								direction: 'out',
								unit: 'kg',
								quantity: '30'
							},
							{
								product_code: 'RESIN-A',
								warehouse: whWest.id,
								direction: 'out',
								unit: 'box',
								quantity: '5'
							}
						]
					}
				]);
				const answer = yield* as.query(stockAvailabilityRead);
				const rows = stockAvailability(answer, Date.parse('2026-11-22T08:10:00Z'));
				const east = rows.find((r) => r.region === 'EAST');
				const west = rows.find((r) => r.region === 'WEST-ONLY');
				// Region WEST-ONLY mismatch must NOT blank Region EAST's projected balance.
				expect(east).toMatchObject({
					unit: 'kg',
					on_hand: '100',
					promised_out: '30',
					projected: '70'
				});
				// Region WEST-ONLY has 0 lots (fallback to product.unit 'kg') vs 'box' commitment -> 'kg / box' and projected null.
				expect(west).toMatchObject({
					unit: 'kg / box',
					on_hand: '0',
					promised_out: '5',
					projected: null
				});
			})
	);
});

layer(shared(), { excludeTestServices: true })('quotation FIFO mixed-unit queue', (it) => {
	it.effect(
		'quotationFifoCosts shares one FIFO lot queue across kg and t lines of the same product',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const as = yield* t.as(t.admin);
				const warehouse = firstRow(
					(yield* as.query({
						warehouses: { where: { external_code: { eq: 'WEST' } }, limit: 1 }
					})).warehouses.rows
				);
				const own = yield* draft(t, 'sales', undefined, '2026-11-22', warehouse.id);
				committed(
					'order_lines',
					yield* as.act({
						'order_lines.update': [
							{
								target: yield* t.at('order_lines', own.line),
								set: { unit: 'kg', quantity: '500', unit_price: '12', tax_rate: '0' }
							}
						],
						'order_lines.create': [
							{
								order: own.order,
								product: PRODUCT,
								unit: 't',
								quantity: '1',
								unit_price: '16000',
								tax_rate: '0'
							}
						]
					})
				);
				yield* businessRows(t, 'stock_snapshots', [
					{
						external_code: 'fifo-lot-cheap',
						product_code: 'RESIN-A',
						warehouse_code: 'WEST',
						lot_number: 'LOT-CHEAP',
						currency: 'SGD',
						unit: 'kg',
						on_hand: '1000',
						unit_cost: '10',
						as_of: '2026-11-22T08:00:00Z'
					},
					{
						external_code: 'fifo-lot-dear',
						product_code: 'RESIN-A',
						warehouse_code: 'WEST',
						lot_number: 'LOT-DEAR',
						currency: 'SGD',
						unit: 'kg',
						on_hand: '2000',
						unit_cost: '20',
						as_of: '2026-11-22T08:00:00Z'
					}
				]);
				const scope = firstRow((yield* as.query(quotationScopeRead(own.order))).orders.rows);
				const baseAnswer = yield* as.query(quotationCostRead(scope));
				// Simulate a Kingdee-synced second line for the same SKU carrying unit 't' alongside a 'kg' line.
				const answer: Parameters<typeof quotationFifoCosts>[0] = {
					...baseAnswer,
					orders: {
						...baseAnswer.orders,
						rows: baseAnswer.orders.rows.map((o) => ({
							...o,
							lines: o.lines.map((l) => (l.id === own.line ? l : { ...l, unit: 't' }))
						}))
					}
				};
				const purchase: Parameters<typeof quotationFifoCosts>[1] = {
					id: fixtureId('source_lot_costs', 'lc-1'),
					currency: 'SGD',
					observed_at: '2026-11-22T08:00:00Z',
					entries: [
						{
							product_code: 'RESIN-A',
							lot_number: 'LOT-CHEAP',
							unit: 'kg',
							received_qty: '1000',
							unit_cost: '10',
							received_on: '2026-10-01'
						},
						{
							product_code: 'RESIN-A',
							lot_number: 'LOT-DEAR',
							unit: 'kg',
							received_qty: '2000',
							unit_cost: '20',
							received_on: '2026-11-01'
						}
					]
				};
				const results = quotationFifoCosts(answer, purchase, '2026-11-22T08:10:00Z', {
					active: true,
					status: { state: 'connected', databaseVerified: true }
				});
				// Total demand = 500 kg + 1 t = 1500 kg (or 1.5 t) -> consumes 1000 kg @ 10 + 500 kg @ 20 = 20,000 (NOT 15,000!).
				expect(results).toHaveLength(1);
				expect(sameDecimal(results[0]?.quantity, results[0]?.unit === 't' ? '1.5' : '1500')).toBe(
					true
				);
				expect(sameDecimal(results[0]?.estimate?.total, '20000')).toBe(true);
				expect(results[0]?.below).toBe(false);
			})
	);
});
