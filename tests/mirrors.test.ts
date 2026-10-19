import { firstRow } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Schema, Effect } from 'effect';
import { DatabaseRequest, type Json } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { direct } from './synced-kit.js';
import { sourceFixture } from './source-fixture.js';
import { expect, it as test } from '@effect/vitest';
import { committed, confirm, PRODUCT, workspace } from './kit.js';
const now = '2026-10-10T00:00:00Z';
test.live(
	'ERP mirrors converge by external identity, resolve references and preserve an existing SO seal',
	() =>
		Effect.gen(function* () {
			const sources: Record<string, Json[]> = {
				'/parties': [
					{
						external_code: 'ERP-C',
						name: 'ERP customer',
						kind: 'customer',
						currency: 'SGD',
						active: true,
						source_updated_at: now
					}
				],
				'/warehouses': [
					{
						external_code: 'WEST',
						name: 'West warehouse',
						group_code: 'WEST',
						active: true,
						source_updated_at: now
					}
				],
				'/products': [
					{
						external_code: 'ERP-P',
						name: 'ERP resin',
						unit: 'kg',
						currency: 'SGD',
						unit_price: '2',
						tax_rate: '9',
						active: true,
						source_updated_at: now
					}
				],
				'/stock_snapshots': [
					{
						external_code: 'ERP-P:WEST',
						product_code: 'ERP-P',
						warehouse_code: 'WEST',
						unit: 'kg',
						on_hand: '100',
						as_of: now
					}
				],
				'/credit_snapshots': [
					{
						external_code: 'ERP-C:SGD',
						party_code: 'ERP-C',
						currency: 'SGD',
						credit_limit: '1000',
						credit_used: '0',
						as_of: now
					}
				]
			};
			const t = yield* workspace({
				source: sourceFixture(() => sources)
			});
			const as = t.as(t.admin);
			let sequence = 0;
			const pull = (collection: string) => t.pull(collection, `mirror-test-${sequence++}`);
			expect(yield* pull('parties')).toMatchObject({ pages: expect.any(Number) });
			const first = firstRow(
				(yield* as.read('parties', { where: { external_code: { eq: 'ERP-C' } }, all: true })).rows
			);
			expect(yield* pull('parties')).toMatchObject({ pages: expect.any(Number) });
			const repeated = (yield* as.read('parties', {
				where: { external_code: { eq: 'ERP-C' } },
				all: true
			})).rows;
			expect(repeated).toHaveLength(1);
			expect(repeated[0]?.id).toEqual(first.id);
			expect(yield* pull('warehouses')).toMatchObject({ pages: expect.any(Number) });
			expect(yield* pull('products')).toMatchObject({ pages: expect.any(Number) });
			const product = firstRow(
				(yield* as.read('products', { where: { external_code: { eq: 'ERP-P' } }, all: true })).rows
			);
			expect(yield* pull('stock_snapshots')).toMatchObject({ pages: expect.any(Number) });
			const stock = firstRow((yield* as.read('stock_snapshots', { all: true })).rows);
			expect(stock).toMatchObject({
				product: product.id,
				erp_committed: null,
				orders_as_of: null
			});
			expect(yield* pull('credit_snapshots')).toMatchObject({ pages: expect.any(Number) });
			expect((yield* as.read('credit_snapshots', { all: true })).rows[0]).toMatchObject({
				party: first.id
			});
			const order = committed(
				'orders',
				yield* as.act('orders.create', {
					title: 'Mirrored customer SO',
					direction: 'sales',
					party: first.id,
					currency: 'SGD',
					payment_terms: 'Net 30'
				})
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.create', {
					order,
					product: product.id,
					quantity: Decimal.of('10'),
					unit_price: Decimal.of('2'),
					tax_rate: Decimal.of('9'),
					discount_pct: Decimal.of('0')
				})
			);
			yield* confirm(t, order);
			const sealed = yield* as.get('orders', order);
			sources['/products'] = [
				{
					external_code: 'ERP-P',
					name: 'Changed catalogue description',
					unit: 'kg',
					currency: 'SGD',
					unit_price: '99',
					tax_rate: '20',
					active: true,
					source_updated_at: now
				}
			];
			sources['/parties'] = [
				{
					external_code: 'ERP-C',
					name: 'Inactive ERP customer',
					kind: 'customer',
					currency: 'SGD',
					active: false,
					source_updated_at: now
				}
			];
			expect(yield* pull('products')).toMatchObject({ pages: expect.any(Number) });
			expect(yield* pull('parties')).toMatchObject({ pages: expect.any(Number) });
			expect(yield* as.get('orders', order)).toMatchObject({
				seal_hash: sealed?.seal_hash,
				sealed_snapshot: sealed?.sealed_snapshot,
				sealed_contract: sealed?.sealed_contract
			});
			expect(yield* as.get('parties', first.id)).toMatchObject({ active: false });
			expect(
				yield* Effect.flip(
					as.act('orders.create', {
						title: 'Inactive',
						direction: 'sales',
						party: first.id,
						currency: 'SGD',
						payment_terms: 'Net 30'
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* direct(t, as.authority, {
					collection: 'products',
					verb: 'update',
					input: { target: PRODUCT, set: { name: 'Local override' } }
				})
			).not.toMatchObject({ kind: 'committed' });
		})
);
test.live('stock import refuses an unknown product instead of fabricating a relationship', () =>
	Effect.gen(function* () {
		const t = yield* workspace({
			source: sourceFixture(() => ({
				'/stock_snapshots': [
					{
						external_code: 'UNKNOWN:WEST',
						product_code: 'UNKNOWN',
						warehouse_code: 'WEST',
						unit: 'kg',
						on_hand: '100',
						as_of: now
					}
				]
			}))
		});
		yield* Effect.tryPromise({
			try: () =>
				expect(Effect.runPromise(t.pull('stock_snapshots', 'bad-reference'))).rejects.toBeDefined(),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		});
		expect((yield* t.as(t.admin).read('stock_snapshots', { all: true })).rows).toEqual([]);
	})
);
test.live('two accounting accounts keep the same remote identity and references independent', () =>
	Effect.gen(function* () {
		const row = (name: string) => ({
			external_code: 'SAME',
			name,
			kind: 'customer',
			currency: 'SGD',
			active: true,
			source_updated_at: now
		});
		let secondName = 'Second customer';
		const firstSource = sourceFixture(() => ({ '/parties': [row('First customer')] }));
		const secondSource = sourceFixture(() => ({ '/parties': [row(secondName)] }));
		const t = yield* workspace({ source: firstSource });
		const second = committed(
			'sys_integration',
			yield* t.as(t.admin).act('sys_integration.create', {
				integration: 'kingdee',
				name: 'Second accounting account'
			})
		);
		t.fakes.links.answer = (instance, op) =>
			Schema.decodeUnknownEffect(DatabaseRequest)(op).pipe(
				Effect.mapError(
					(cause) => new FacilityFailure({ kind: 'invalid', message: String(cause) })
				),
				Effect.flatMap((request) => (instance === second ? secondSource : firstSource)(request))
			);
		yield* t.pull('parties');
		yield* t.pull('parties', 'second-account-first', second);
		const rows = (yield* t
			.as(t.admin)
			.read('parties', { where: { external_code: { eq: 'SAME' } }, all: true })).rows;
		expect(rows).toHaveLength(2);
		expect(new Set(rows.map((row) => row.id)).size).toBe(2);
		expect(new Set(rows.map((row) => row.source))).toEqual(new Set(['kingdee', second]));
		secondName = 'Second customer updated';
		yield* t.pull('parties', 'second-account-updated', second);
		const first = rows.find((row) => row.source === 'kingdee'),
			other = rows.find((row) => row.source === second);
		if (first === undefined || other === undefined) throw new Error('Both ledger rows required');
		expect(yield* t.as(t.admin).get('parties', first.id)).toMatchObject({ name: 'First customer' });
		expect(yield* t.as(t.admin).get('parties', other.id)).toMatchObject({ name: secondName });
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
