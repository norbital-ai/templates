import { fixtureId, decimalText, firstRow } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema, Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { Instant } from '@norbital-ai/std/date';
import { d } from '../src/lib/commercial.js';
import { availability } from '../src/lib/stock.js';
import { workspace } from './kit.js';
const id = <C extends 'products' | 'warehouses' | 'orders' | 'order_lines'>(
	collection: C,
	suffix: string
) => fixtureId(collection, `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`);
const now = Instant('2026-10-10T00:00:00Z');
const source = {
	product: id('products', '201'),
	warehouse: id('warehouses', '301'),
	unit: 'kg',
	on_hand: d('100'),
	erp_committed: d('30'),
	as_of: now,
	orders_as_of: now
} satisfies Parameters<typeof availability>[0];
const order = {
	id: id('orders', '901'),
	warehouse: source.warehouse,
	direction: 'sales',
	status: 'confirmed',
	sealed_at: now,
	seal_hash: 'sealed'
} satisfies NonNullable<Parameters<typeof availability>[3]>['orders'][number];
const line = {
	id: id('order_lines', '902'),
	order: order.id,
	product: source.product,
	unit: 'kg',
	quantity: d('80')
} satisfies NonNullable<Parameters<typeof availability>[3]>['lines'][number];
const commitments = { orders: [order], lines: [line], receipts: [], delivered: [] };
test('fresh compatible stock retains negative projected balances and does not count ERP-included orders twice', () => {
	expect(availability(source, now, 30, commitments)).toMatchObject({
		sellable: '70',
		local_committed: '80',
		projected: '-10',
		reason: 'available'
	});
	const acknowledged = {
		order: order.id,
		status: 'issued',
		agreement_hash: 'sealed',
		source_updated_at: now
	} as const;
	expect(availability(source, now, 30, { ...commitments, receipts: [acknowledged] })).toMatchObject(
		{ local_committed: '0', projected: '70' }
	);
	expect(
		availability({ ...source, orders_as_of: Instant('2026-10-09T23:59:00Z') }, now, 30, {
			...commitments,
			receipts: [acknowledged]
		})
	).toMatchObject({ local_committed: '80', projected: '-10' });
});
test('unknown, stale, mixed units and unreconciled delivery never fabricate availability', () => {
	expect(
		availability({ ...source, as_of: Instant('2026-10-09T00:00:00Z') }, now, 30, commitments)
	).toMatchObject({ sellable: null, projected: null, reason: 'stale_source' });
	expect(availability({ ...source, orders_as_of: null }, now, 30, commitments)).toMatchObject({
		projected: null,
		reason: 'stale_source'
	});
	expect(
		availability({ ...source, as_of: Instant('2026-10-11T00:00:00Z') }, now, 30, commitments)
	).toMatchObject({ projected: null });
	expect(availability({ ...source, erp_committed: null }, now, 30, commitments)).toMatchObject({
		projected: null,
		reason: 'missing_commitments'
	});
	expect(
		availability(source, now, 30, { ...commitments, lines: [{ ...line, unit: 'box' }] })
	).toMatchObject({ sellable: '70', projected: null, reason: 'unit_mismatch' });
	expect(
		availability(source, now, 30, {
			...commitments,
			delivered: [{ order_line: line.id, quantity: d('5') }]
		})
	).toMatchObject({ projected: null, reason: 'delivery_unreconciled' });
	expect(availability(source, now, 30)).toMatchObject({
		sellable: '70',
		projected: null,
		reason: 'erp_only'
	});
});
test.live(
	'sales cannot invoke the global commitment projection while logistics and managers can',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const sales = t.member(['sales']);
			expect(yield* t.as(sales).query('stock_snapshots.erp_availability', {})).toEqual([]);
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(t.as(sales).query('stock_snapshots.projected_availability', {}))
					).rejects.toThrow(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			for (const policy of ['manager', 'logistics', 'finance']) {
				const actor = t.member([policy]);
				expect(yield* t.as(actor).query('stock_snapshots.projected_availability', {})).toEqual([]);
			}
		})
);
test.live(
	'stock query returns exact source quantities without commercial fields to logistics',
	() =>
		Effect.gen(function* () {
			const products = (yield* Effect.tryPromise({
				try: () => import('../seed/products.json', { with: { type: 'json' } }),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			})).default;
			const warehouses = (yield* Effect.tryPromise({
				try: () => import('../seed/warehouses.json', { with: { type: 'json' } }),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			})).default;
			const settings = (yield* Effect.tryPromise({
				try: () => import('../seed/commercial_settings.json', { with: { type: 'json' } }),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			})).default;
			const t = yield* workspace({
				seed: {
					products,
					warehouses,
					commercial_settings: settings,
					stock_snapshots: [
						{
							id: '00000000-0000-4000-8000-000000000501',
							external_code: 'RESIN-A:WEST:kg',
							...source,
							source: 'kingdee',
							on_hand: '100',
							erp_committed: '130'
						}
					]
				}
			});
			const as = t.as(t.member(['logistics']));
			const rows = yield* as.query('stock_snapshots.projected_availability', {});
			expect(rows).toMatchObject([
				{
					product: source.product,
					product_name: 'Resin A',
					warehouse_name: 'West warehouse',
					warehouse: source.warehouse,
					sellable: decimalText('-30'),
					local_committed: decimalText('0'),
					projected: decimalText('-30'),
					reason: 'available'
				}
			]);
			expect(rows).not.toMatchObject([{ unit_price: expect.anything() }]);
		})
);
test('stock keeps approved quota while drafting and waits for an amended source confirmation', () => {
	const operational_contracts = [
		{
			seal_hash: 'sealed',
			lines: [{ id: line.id, product: line.product, unit: line.unit, quantity: '80' }]
		}
	];
	const drafting = { ...order, status: 'draft' as const, operational_contracts };
	expect(
		availability(source, now, 30, {
			...commitments,
			orders: [drafting],
			lines: [{ ...line, quantity: d('20') }]
		})
	).toMatchObject({ local_committed: '80', projected: '-10' });
	const oldReceipt = {
		order: order.id,
		status: 'issued' as const,
		agreement_hash: 'sealed',
		source_updated_at: now
	};
	expect(
		availability(source, now, 30, { ...commitments, orders: [drafting], receipts: [oldReceipt] })
	).toMatchObject({ local_committed: '0', projected: '70' });
	const amended = {
		...order,
		seal_hash: 'new',
		operational_contracts: [
			...operational_contracts,
			{
				seal_hash: 'new',
				lines: [{ ...firstRow(firstRow(operational_contracts).lines), quantity: '100' }]
			}
		]
	};
	expect(
		availability(source, now, 30, { ...commitments, orders: [amended], receipts: [oldReceipt] })
	).toMatchObject({ projected: null, reason: 'contract_unreconciled' });
	expect(
		availability(source, now, 30, {
			...commitments,
			orders: [amended],
			receipts: [{ ...oldReceipt, agreement_hash: 'new' }]
		})
	).toMatchObject({ projected: '70' });
});
test.live(
	'average inventory cost weights remaining lots and leaves incomplete cost evidence unknown',
	() =>
		Effect.gen(function* () {
			const { averageLotCost } = yield* Effect.tryPromise({
				try: () => import('../src/lib/lot-cost.js'),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const base = { product: 'resin', unit: 'kg', currency: 'SGD', on_hand: '10', unit_cost: '2' };
			const rows = [
				base,
				{ ...base, on_hand: '30', unit_cost: '4' },
				{ ...base, on_hand: '0', unit_cost: '99' },
				{ ...base, currency: 'USD', unit_cost: '99' }
			];
			expect(averageLotCost(rows, 'resin', 'kg', 'SGD')?.toString()).toBe('3.50000000');
			expect(
				averageLotCost([...rows, { ...base, unit_cost: null }], 'resin', 'kg', 'SGD')
			).toBeNull();
			expect(averageLotCost(rows, 'resin', 'box', 'SGD')).toBeNull();
		})
);
test.live('sales get a below-average lot cost warning without blocking an editable draft', () =>
	Effect.gen(function* () {
		const { sourceFixture } = yield* Effect.tryPromise({
			try: () => import('./source-fixture.js'),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		});
		const { draft, committed } = yield* Effect.tryPromise({
			try: () => import('./kit.js'),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		});
		const lots = ['2', '4'].map((unit_cost, i) => ({
			external_code: `LOT-${i}`,
			lot_number: `LOT-${i}`,
			product_code: 'RESIN-A',
			warehouse_code: 'WEST',
			unit: 'kg',
			currency: 'SGD',
			unit_cost,
			on_hand: i ? '30' : '10',
			erp_committed: '0',
			as_of: '2026-10-10T00:00:00Z',
			orders_as_of: '2026-10-10T00:00:00Z'
		}));
		const t = yield* workspace({ source: sourceFixture(() => ({ '/stock_snapshots': lots })) });
		expect(yield* t.pull('stock_snapshots', 'lot-warning')).toMatchObject({
			pages: expect.any(Number)
		});
		const own = yield* draft(t);
		const as = t.as(t.admin);
		expect(yield* as.query('orders.confirmation_check', { order: own.order })).toMatchObject({
			below_inventory_cost: ['Resin A']
		});
		committed(
			'order_lines',
			yield* as.act('order_lines.update', {
				target: own.line,
				set: { unit_price: Decimal.of('4') }
			})
		);
		expect(yield* as.query('orders.confirmation_check', { order: own.order })).toMatchObject({
			below_inventory_cost: []
		});
		expect(
			yield* Effect.flip(
				as.act('orders.update', { target: own.order, set: { direction: 'purchasing' } })
			)
		).toMatchObject({ _tag: 'ActRefused' });
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
