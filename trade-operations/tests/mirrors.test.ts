import { firstRow } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { direct } from './synced-kit.js';
import { businessRows } from './business-source.js';
import { expect, it as test } from '@effect/vitest';
import { committed, confirm, workspace } from './kit.js';

const now = '2026-10-10T00:00:00Z';

// Physical SQL mapping and account isolation are covered by the Kingdee adapter tests.
test.live(
	'source-owned master refreshes preserve the existing local identity and sealed sales agreement',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const customer = {
				external_code: 'ERP-C',
				name: 'ERP customer',
				kind: 'customer',
				currency: 'SGD',
				active: true,
				source_updated_at: now
			};
			yield* businessRows(t, 'parties', [customer]);
			const first = firstRow(
				(yield* as.query({
					parties: {
						where: { external_code: { eq: customer.external_code } }
					}
				})).parties.rows
			);
			yield* businessRows(t, 'parties', [customer]);
			expect(
				(yield* as.query({
					parties: {
						where: { external_code: { eq: customer.external_code } }
					}
				})).parties.rows.map((row) => row.id)
			).toEqual([first.id]);
			const sourceProduct = {
				external_code: 'ERP-P',
				name: 'ERP resin',
				unit: 'kg',
				currency: 'SGD',
				unit_price: '2',
				tax_rate: '9',
				active: true,
				source_updated_at: now
			};
			yield* businessRows(t, 'products', [sourceProduct]);
			const product = firstRow(
				(yield* as.query({
					products: {
						where: { external_code: { eq: sourceProduct.external_code } }
					}
				})).products.rows
			);
			const order = committed(
				'orders',
				yield* as.act('orders.create', [
					{
						title: 'Source-owned customer sale',
						direction: 'sales',
						party: first.id,
						currency: 'SGD',
						payment_terms: 'Net 30'
					}
				])
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.create', [
					{
						order,
						product: product.id,
						quantity: Decimal.of('10'),
						unit_price: Decimal.of('2'),
						tax_rate: Decimal.of('9'),
						discount_pct: Decimal.of('0')
					}
				])
			);
			yield* confirm(t, order);
			const sealed = (yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
				.orders.rows[0];
			yield* businessRows(t, 'products', [
				{
					...sourceProduct,
					name: 'Changed catalogue description',
					unit_price: '99',
					tax_rate: '20'
				}
			]);
			yield* businessRows(t, 'parties', [
				{ ...customer, name: 'Inactive source customer', active: false }
			]);
			expect(
				(yield* as.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders.rows[0]
			).toMatchObject({
				seal_hash: sealed?.seal_hash,
				sealed_snapshot: sealed?.sealed_snapshot,
				sealed_contract: sealed?.sealed_contract
			});
			expect(
				(yield* as.query({ parties: { where: { id: { eq: first.id } }, limit: 1 } })).parties
					.rows[0]
			).toMatchObject({ active: false });
			expect(
				yield* Effect.flip(
					as.act('orders.create', [
						{
							title: 'Inactive',
							direction: 'sales',
							party: first.id,
							currency: 'SGD',
							payment_terms: 'Net 30'
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				yield* direct(t, as.authority, {
					model: 'products',
					verb: 'update',
					input: [{ target: product.id, set: { name: 'Local override' } }]
				})
			).not.toMatchObject({ kind: 'committed' });
		})
);
