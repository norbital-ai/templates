import { PlainDate } from '@norbital-ai/std/date';
import { fixtureId, decimalText, firstRow } from './test-runtime.js';
import { Schema, Effect } from 'effect';
import { businessRows } from './business-source.js';
import { sourceOrder, sourceTransaction, direct } from './synced-kit.js';
import { expect, it as test } from '@effect/vitest';
import type { Json } from '@norbital-ai/bolt/engine';
import { committed, confirm, draft, SETTINGS, workspace, type T } from './kit.js';
const stamp = '2026-10-10T00:00:00Z';
const fact = Effect.fnUntraced(function* (
	t: T,
	order: Effect.Success<ReturnType<typeof draft>>,
	external_code: string
) {
	const sealed = yield* t.as(t.admin).query('orders', { id: order.order });
	expect(sealed?.seal_hash).toBeTruthy();
	return {
		external_code,
		order_id: order.order,
		order_line_id: order.line,
		kind: 'shipment',
		reference: external_code,
		business_on: '2026-09-15',
		source_updated_at: stamp,
		seal_hash: String(sealed?.seal_hash),
		unit: 'kg',
		quantity: '10',
		currency: 'SGD',
		net_amount: '20',
		tax_amount: '1.80',
		freight: '3',
		active: true
	};
});
const sourceWorkspace = Effect.fnUntraced(function* () {
	const t = yield* workspace();
	return {
		t,
		pull: (rows: Json[]) => businessRows(t, 'source_sales_lines', rows)
	};
});
test.live(
	'ERP sales report uses signed facts, source month, captured freight and owner scope without changing SO seals',
	() =>
		Effect.gen(function* () {
			const { t, pull } = yield* sourceWorkspace();
			const as = t.as(t.admin),
				sales = t.member(['sales']),
				other = t.member(['sales']);
			const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.id), '2026-08-01');
			const foreign = yield* draft(t, 'sales', fixtureId('sys_user', other.id), '2026-08-01');
			yield* confirm(t, own.order);
			yield* confirm(t, foreign.order);
			const sealed = yield* as.query('orders', { id: own.order });
			const shipment = yield* fact(t, own, 'SHIP-1');
			const returned = {
				...shipment,
				external_code: 'RETURN-1',
				kind: 'return',
				quantity: '-2',
				net_amount: '-4',
				tax_amount: '-0.36',
				freight: '-0.60'
			};
			const foreignFact = yield* fact(t, foreign, 'FOREIGN-1');
			const missing = {
				...shipment,
				external_code: 'MISSING-1',
				business_on: '2026-10-01',
				freight: null
			};
			yield* pull([shipment, returned, foreignFact, missing]);
			yield* pull([shipment, returned, foreignFact, missing]);
			expect((yield* as.query('source_sales_lines', { all: true })).rows).toHaveLength(4);
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(
							t.as(sales).query('orders.sales_detail', {
								from: PlainDate('2026-09-30'),
								to: PlainDate('2026-09-01')
							})
						)
					).rejects.toThrow('errors.report_range'),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const detail = yield* t.as(sales).query('orders.sales_detail', {
				from: PlainDate('2026-09-01'),
				to: PlainDate('2026-09-30')
			});
			expect(detail).toHaveLength(2);
			expect(detail).toMatchObject(
				expect.arrayContaining([
					expect.objectContaining({
						order: own.order,
						external_code: 'RETURN-1',
						net: decimalText('-3.40')
					})
				])
			);
			expect(JSON.stringify(detail)).not.toContain('FOREIGN-1');
			const before = yield* t.as(sales).query('orders.sales_analysis', {});
			expect(
				yield* t.as(sales).query('orders.sales_analysis', {
					from: PlainDate('2026-10-01'),
					to: PlainDate('2026-10-31')
				})
			).toHaveLength(1);
			expect(
				yield* t.as(sales).query('orders.sales_analysis', {
					from: PlainDate('2026-12-01'),
					to: PlainDate('2026-12-31')
				})
			).toEqual([]);
			expect(before).toMatchObject([
				{
					period: '2026-10-01',
					owner: fixtureId('sys_user', sales.id),
					orders: 1,
					source_lines: 1,
					unresolved_lines: 1,
					net: null,
					tax: decimalText('1.80'),
					total: decimalText('21.80'),
					freight: null
				},
				{
					period: '2026-09-01',
					owner: fixtureId('sys_user', sales.id),
					freight_treatment: 'deduct',
					orders: 1,
					source_lines: 2,
					unresolved_lines: 0,
					net: decimalText('13.60'),
					tax: decimalText('1.44'),
					total: decimalText('17.44'),
					freight: decimalText('2.40')
				}
			]);
			expect((yield* t.as(sales).query('source_sales_lines', { all: true })).rows).toHaveLength(3);
			const logistics = t.member(['logistics']);
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(t.as(logistics).query('source_sales_lines', { all: true }))
					).rejects.toThrow(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const parent = yield* sourceOrder(t, own.order);
			yield* sourceTransaction(t, own, parent, 'delivery');
			expect(yield* t.as(sales).query('orders.sales_analysis', {})).toEqual(before);
			committed(
				'commercial_settings',
				yield* as.act('commercial_settings.update', {
					target: SETTINGS,
					set: { freight_treatment: 'include' }
				})
			);
			const second = yield* draft(t, 'sales', fixtureId('sys_user', sales.id), '2026-08-01');
			yield* confirm(t, second.order);
			const included = {
				...(yield* fact(t, second, 'INCLUDED-1')),
				freight: null,
				net_amount: '8',
				tax_amount: '0.72'
			};
			// A later source fact does not replace previously recorded business evidence.
			yield* pull([included]);
			expect((yield* as.query('source_sales_lines', { all: true })).rows).toHaveLength(5);
			expect(yield* t.as(sales).query('orders.sales_analysis', {})).toMatchObject([
				{ period: '2026-10-01', net: null },
				{ freight_treatment: 'deduct', net: decimalText('13.60') },
				{
					freight_treatment: 'include',
					source_lines: 1,
					unresolved_lines: 1,
					net: decimalText('8.00'),
					tax: decimalText('0.72'),
					total: decimalText('8.72'),
					freight: null
				}
			]);
			yield* pull([{ ...returned, active: false, source_updated_at: '2026-10-10T00:00:01Z' }]);
			expect(yield* t.as(sales).query('orders.sales_analysis', {})).toMatchObject([
				{ period: '2026-10-01', net: null },
				{ freight_treatment: 'deduct', source_lines: 1, net: decimalText('17.00') },
				{ freight_treatment: 'include', net: decimalText('8.00') }
			]);
			expect(yield* as.query('orders', { id: own.order })).toMatchObject({
				seal_hash: sealed?.seal_hash,
				sealed_snapshot: sealed?.sealed_snapshot,
				sealed_contract: sealed?.sealed_contract,
				freight_treatment: 'deduct'
			});
			const sourceLine = firstRow((yield* as.query('source_sales_lines', { all: true })).rows);
			expect(
				yield* direct(t, as.authority, {
					collection: 'source_sales_lines',
					verb: 'update',
					input: { target: sourceLine.id, set: { net_amount: '99' } }
				})
			).not.toMatchObject({ kind: 'committed' });
		})
);
test.live('a confirmed commitment without ERP sales facts does not become realized sales', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const own = yield* draft(t);
		yield* confirm(t, own.order);
		expect(yield* t.as(t.admin).query('orders.sales_analysis', {})).toEqual([]);
	})
);
test.live(
	'sales facts retain sealed freight treatment when later orders use updated settings',
	() =>
		Effect.gen(function* () {
			const { t, pull } = yield* sourceWorkspace();
			const as = t.as(t.admin);
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const original = yield* fact(t, own, 'VERSION-1');
			yield* pull([original]);
			expect(yield* as.query('orders.sales_analysis', {})).toMatchObject([
				{ freight_treatment: 'deduct', net: decimalText('17.00') }
			]);
			committed(
				'commercial_settings',
				yield* as.act('commercial_settings.update', {
					target: SETTINGS,
					set: { freight_treatment: 'include' }
				})
			);
			const subsequent = yield* draft(t);
			yield* confirm(t, subsequent.order);
			const next = { ...(yield* fact(t, subsequent, 'VERSION-2')), net_amount: '30' };
			const late = {
				...original,
				external_code: 'VERSION-1-LATE',
				quantity: '1',
				net_amount: '2',
				freight: '0.30'
			};
			yield* pull([original, next, late]);
			expect(yield* as.query('orders.sales_analysis', {})).toMatchObject([
				{ freight_treatment: 'deduct', source_lines: 2, net: decimalText('18.70') },
				{ freight_treatment: 'include', source_lines: 1, net: decimalText('30.00') }
			]);
			expect(yield* as.query('orders.sales_detail', {})).toMatchObject(
				expect.arrayContaining([
					expect.objectContaining({ external_code: 'VERSION-1-LATE', net: decimalText('1.70') }),
					expect.objectContaining({ external_code: 'VERSION-2', net: decimalText('30.00') })
				])
			);
		})
);
test.live('late source facts retain the sealed SKU name after catalogue changes', () =>
	Effect.gen(function* () {
		const { t, pull } = yield* sourceWorkspace();
		const as = t.as(t.admin);
		const own = yield* draft(t);
		yield* confirm(t, own.order);
		const original = yield* fact(t, own, 'ARCHIVED-SKU');
		yield* businessRows(t, 'products', [
			{
				external_code: 'RESIN-A',
				name: 'Changed catalogue name',
				unit: 'kg',
				currency: 'SGD',
				unit_price: '99',
				tax_rate: '9',
				active: false,
				source_updated_at: '2026-10-10T00:00:01Z'
			}
		]);
		yield* pull([original]);
		expect(yield* as.query('orders.sales_detail', {})).toMatchObject([
			{ external_code: 'ARCHIVED-SKU', product_name: 'Resin A', net: decimalText('17.00') }
		]);
		yield* pull([original]);
		expect((yield* as.query('source_sales_lines', { all: true })).rows).toHaveLength(1);
	})
);
test.live(
	'transaction margin uses the consumed lot cost and reverses returns without estimating unknown costs',
	() =>
		Effect.gen(function* () {
			const { t, pull } = yield* sourceWorkspace();
			const own = yield* draft(t);
			yield* confirm(t, own.order);
			const original = {
				...(yield* fact(t, own, 'LOT-SHIP')),
				lot_number: 'L001',
				unit_cost: '1.2'
			};
			yield* pull([
				original,
				{
					...original,
					external_code: 'LOT-RETURN',
					kind: 'return',
					quantity: '-2',
					net_amount: '-4',
					tax_amount: '-0.36',
					freight: '-0.60'
				},
				{ ...original, external_code: 'UNKNOWN-COST', lot_number: null, unit_cost: null }
			]);
			expect(yield* t.as(t.admin).query('orders.sales_detail', {})).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						external_code: 'LOT-SHIP',
						cost: decimalText('12.00'),
						margin: decimalText('5.00')
					}),
					expect.objectContaining({
						external_code: 'LOT-RETURN',
						cost: decimalText('-2.40'),
						margin: decimalText('-1.00')
					}),
					expect.objectContaining({ external_code: 'UNKNOWN-COST', cost: null, margin: null })
				])
			);
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
