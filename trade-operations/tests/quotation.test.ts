import { sameDecimal } from './test-runtime.js';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { committed, confirm, draft, PRODUCT, SETTINGS, workspace, NET60 } from './kit.js';
import { documentOf, quotationOf } from './reads.js';
import { businessRows } from './business-source.js';
test.live('a quotation syncs as the same order and line records', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = yield* t.as(t.admin);
		const own = yield* draft(t);
		const before = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
			.orders.rows[0];
		expect(before?.status).toBe('draft');
		committed(
			'orders',
			yield* as.act({
				'orders.update': [
					{
						target: yield* t.at('orders', own.order),
						set: {
							payment_terms: NET60,
							valid_from: '2026-08-01',
							valid_until: '2026-12-31'
						}
					}
				]
			})
		);
		committed(
			'order_lines',
			yield* as.act({
				'order_lines.update': [
					{ target: yield* t.at('order_lines', own.line), set: { unit_price: '3' } }
				]
			})
		);
		// the draft's document is its quotation: the saved terms, unsealed
		const quoted = yield* documentOf(as, { order: own.order });
		expect(quoted.reference).toBe(before?.number);
		expect(quoted.filename).toMatch(/-(quotation|draft)\.pdf$/);
		expect(quoted.html).toContain('Net 60');
		expect(quoted.html).toContain('2026-08-01');
		expect(quoted.html).toContain('2026-12-31');
		yield* confirm(t, own.order);
		const after = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
			.orders.rows[0];
		expect(after).toMatchObject({
			id: before?.id,
			number: before?.number,
			status: 'confirmed',
			payment_terms: NET60,
			valid_from: '2026-08-01',
			valid_until: '2026-12-31'
		});
		expect(
			(yield* as.query({ order_lines: { where: { order: { eq: own.order } } } })).order_lines.rows
		).toMatchObject([{ id: own.line }]);
	})
);
test.live('contract validity rejects reversed dates including a partial edit', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = yield* t.as(t.admin);
		const { order } = yield* draft(t);
		committed(
			'orders',
			yield* as.act({
				'orders.update': [
					{
						target: yield* t.at('orders', order),
						set: { valid_from: '2026-08-01', valid_until: '2026-12-31' }
					}
				]
			})
		);
		expect(
			yield* Effect.flip(
				as.act({
					'orders.update': [
						{ target: yield* t.at('orders', order), set: { valid_until: '2026-07-31' } }
					]
				})
			)
		).toMatchObject({ _tag: 'ActRefused', key: 'errors.contract_validity' });
	})
);

test.live('a line keeps the floor in force on its order date; the refuse rule holds the sync', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = yield* t.as(t.admin);
		const warehouse = (yield* as.query({
			warehouses: { where: { external_code: { eq: 'WEST' } }, limit: 1 }
		})).warehouses.rows[0];
		const group = warehouse?.group_code;
		if (!warehouse || !group) throw new Error('Fixture warehouse group missing');
		const { order, line } = yield* draft(t, 'sales', undefined, '2026-08-01', warehouse.id);
		const other = (yield* as.query({ products: { where: { id: { ne: PRODUCT } }, limit: 1 } }))
			.products.rows[0];
		if (!other) throw new Error('Second fixture product missing');
		yield* businessRows(
			t,
			'stock_snapshots',
			[
				{ product_code: 'RESIN-A', external_code: 'own-lot' },
				{ product_code: other.external_code, external_code: 'other-lot' }
			].map((row) => ({
				...row,
				warehouse_code: 'WEST',
				lot_number: row.external_code,
				currency: 'SGD',
				unit: 'kg',
				on_hand: '10',
				unit_cost: '2.5',
				as_of: '2026-08-01T00:00:00Z'
			}))
		);
		committed(
			'pricing_floors',
			yield* as.act({
				'pricing_floors.create': ['2026-07-01', '2026-08-02'].map((day, index) => ({
					product: PRODUCT,
					currency: 'SGD' as const,
					unit: 'kg',
					group_code: group,
					effective_on: day,
					floor_price: index === 0 ? '3.27' : '5.45',
					tax_inclusive: true,
					tax_rate: '9',
					minimum_quantity: '0'
				}))
			})
		);
		committed(
			'commercial_settings',
			yield* as.act({
				'commercial_settings.update': [
					{ target: yield* t.at('commercial_settings', SETTINGS), set: { floor_rule: 'refuse' } }
				]
			})
		);
		// the quotation reads only its own products' lots, and flags the line priced under their cost
		const quoted = yield* quotationOf(as, order);
		expect(quoted.answer.stock_snapshots.rows).toHaveLength(1);
		expect(quoted.below_inventory_cost).toHaveLength(1);
		// the line was priced before the floor existed; the sync checks the floor in force now
		expect(
			yield* Effect.flip(
				as.act({
					'orders.update': [{ target: yield* t.at('orders', order), set: { status: 'confirmed' } }]
				})
			)
		).toMatchObject({ _tag: 'ActRefused', key: 'errors.floor_below' });
		committed(
			'order_lines',
			yield* as.act({
				'order_lines.update': [
					{ target: yield* t.at('order_lines', line), set: { unit_price: '4' } }
				]
			})
		);
		yield* confirm(t, order);
		const priced = (yield* as.query({ order_lines: { where: { id: { eq: line } }, limit: 1 } }))
			.order_lines.rows[0];
		// the 2026-07-01 floor, net of its 9% tax: the 2026-08-02 one is after the order date
		expect(sameDecimal(priced?.floor_net, '3')).toBe(true);
		expect(priced?.floor_on).toBe('2026-07-01');
	})
);
