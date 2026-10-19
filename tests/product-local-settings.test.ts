import { decimalText } from './test-runtime.js';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace, committed, PRODUCT } from './kit.js';
import { direct } from './synced-kit.js';
import { sourceFixture } from './source-fixture.js';
test.live(
	'authorized SKU commission settings are editable, source identity is protected, and subsequent sync preserves settings',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace({
				source: sourceFixture(() => ({
					'/products': [
						{
							external_code: 'RESIN-A',
							name: 'Updated resin',
							unit: 'kg',
							currency: 'SGD',
							unit_price: '2',
							tax_rate: '9',
							commission_factor: '9',
							commission_basis_unit: 'wrong',
							active: true,
							source_updated_at: '2026-10-10T00:00:00Z'
						}
					]
				}))
			});
			const manager = t.as(t.member(['manager']));
			committed(
				'products',
				yield* manager.act('products.update', {
					target: PRODUCT,
					set: { commission_factor: Decimal.of('0.002'), commission_basis_unit: 't' }
				})
			);
			expect(
				yield* direct(t, manager.authority, {
					collection: 'products',
					verb: 'update',
					input: { target: PRODUCT, set: { name: 'Overwrite source' } }
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(yield* t.pull('products', 'sku-settings')).toMatchObject({
				pages: expect.any(Number)
			});
			expect(yield* manager.get('products', PRODUCT)).toMatchObject({
				name: 'Updated resin',
				commission_factor: decimalText('0.002'),
				commission_basis_unit: 't'
			});
		})
);
