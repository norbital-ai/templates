import { fixtureId, decimalText } from './test-runtime.js';
import { Effect } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import { expect, layer } from '@effect/vitest';
import { Trade, shared, draft, confirm } from './kit.js';
import { sourceOrder, sourceTransaction, sync } from './synced-kit.js';
import { progressOfParty } from './reads.js';
layer(shared(), { excludeTestServices: true })('transactions', (test) => {
	test.effect(
		'SQL invoices allow absent document files while retaining issued-evidence guards',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade,
					own = yield* draft(t);
				yield* confirm(t, own.order);
				const parent = yield* sourceOrder(t, own.order),
					invoice = yield* sourceTransaction(t, own, parent);
				expect(
					yield* sync(t, 'transactions', [{ ...invoice.input, documents: [] }], 'upsert')
				).toMatchObject({ kind: 'committed' });
				for (const change of [
					{
						documents: [
							{
								name: 'invoice.pdf',
								url: 'http://example.test/invoice.pdf',
								sha256: 'a'.repeat(64)
							}
						]
					},
					{ total: null },
					{ ext_sales_order: null }
				])
					expect(
						yield* sync(t, 'transactions', [{ ...invoice.input, ...change }], 'upsert')
					).not.toMatchObject({ kind: 'committed' });
				expect(
					(yield* t
						.as(t.admin)
						.query({ transactions: { where: { id: { eq: invoice.id } }, limit: 1 } })).transactions
						.rows[0]
				).toMatchObject({
					total: decimalText('21.80'),
					issued_on: '2026-08-01',
					documents: []
				});
			})
	);
	test.effect(
		'issued source deliveries remain visible when actual quantities exceed the forecast',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade,
					own = yield* draft(t);
				yield* confirm(t, own.order);
				const parent = yield* sourceOrder(t, own.order);
				yield* sourceTransaction(t, own, parent, 'delivery', '12');
				expect(
					yield* progressOfParty(t.as(t.admin), {
						party: fixtureId('parties', '00000000-0000-4000-8000-000000000101'),
						as_of: PlainDate('2026-10-10')
					})
				).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							quota: decimalText('10'),
							delivered: decimalText('12'),
							fulfillment: decimalText('120.00')
						})
					])
				);
			})
	);
});
