import { PlainDate } from '@norbital-ai/std/date';
import { fixtureId, decimalText } from './test-runtime.js';
import { Schema, Effect } from 'effect';
import { businessRows } from './business-source.js';
import { expect, it } from '@effect/vitest';
import type { Json } from '@norbital-ai/bolt/engine';
import { committed, confirm, draft, SETTINGS, workspace, type T } from './kit.js';
import { salesAnalysisOf, salesDetailOf } from './reads.js';
const stamp = '2026-10-10T00:00:00Z';
const fact = Effect.fnUntraced(function* (
	t: T,
	order: Effect.Success<ReturnType<typeof draft>>,
	external_code: string
) {
	const sealed = (yield* t
		.as(t.admin)
		.query({ orders: { where: { id: { eq: order.order } }, limit: 1 } })).orders.rows[0];
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
const pull = (t: T, rows: Json[]) => businessRows(t, 'source_sales_lines', rows);
it.live(
	'ERP sales report uses signed facts, source month, captured freight, consumed lot cost and owner scope',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin),
				sales = t.member(['sales']),
				other = t.member(['sales']);
			const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.id), '2026-08-01');
			const foreign = yield* draft(t, 'sales', fixtureId('sys_user', other.id), '2026-08-01');
			yield* confirm(t, own.order);
			yield* confirm(t, foreign.order);
			const shipment = { ...(yield* fact(t, own, 'SHIP-1')), lot_number: 'L001', unit_cost: '1.2' };
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
				freight: null,
				lot_number: null,
				unit_cost: null
			};
			yield* pull(t, [shipment, returned, foreignFact, missing]);
			yield* pull(t, [shipment, returned, foreignFact, missing]);
			expect((yield* as.query({ source_sales_lines: {} })).source_sales_lines.rows).toHaveLength(4);
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(
							salesDetailOf(t.as(sales), {
								from: PlainDate('2026-09-30'),
								to: PlainDate('2026-09-01')
							})
						)
					).rejects.toThrow('errors.report_range'),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const detail = yield* salesDetailOf(t.as(sales), {
				from: PlainDate('2026-09-01'),
				to: PlainDate('2026-09-30')
			});
			expect(detail).toHaveLength(2);
			expect(detail).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						external_code: 'SHIP-1',
						cost: decimalText('12.00'),
						margin: decimalText('5.00')
					}),
					expect.objectContaining({
						order: own.order,
						external_code: 'RETURN-1',
						net: decimalText('-3.40'),
						cost: decimalText('-2.40'),
						margin: decimalText('-1.00')
					})
				])
			);
			const before = [
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
			];
			expect(yield* salesAnalysisOf(t.as(sales), {})).toMatchObject(before);
			expect(
				yield* salesAnalysisOf(t.as(sales), {
					from: PlainDate('2026-12-01'),
					to: PlainDate('2026-12-31')
				})
			).toEqual([]);
			// the order captured its freight treatment when sealed: a later setting does not rewrite it
			committed(
				'commercial_settings',
				yield* as.act('commercial_settings.update', [
					{ target: SETTINGS, set: { freight_treatment: 'include' } }
				])
			);
			expect(yield* salesAnalysisOf(t.as(sales), {})).toMatchObject(before);
			yield* pull(t, [{ ...returned, active: false, source_updated_at: '2026-10-10T00:00:01Z' }]);
			expect(yield* salesAnalysisOf(t.as(sales), {})).toMatchObject([
				{ period: '2026-10-01', net: null },
				{ freight_treatment: 'deduct', source_lines: 1, net: decimalText('17.00') }
			]);
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
