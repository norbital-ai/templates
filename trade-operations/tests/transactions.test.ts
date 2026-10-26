import { fixtureId, decimalText } from './test-runtime.js';
import { Effect } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import { expect, it as test } from '@effect/vitest';
import { workspace, draft, confirm } from './kit.js';
import { sourceOrder, sourceTransaction, sync } from './synced-kit.js';
test.live(
	'finalizing an agreement does not create a duplicate order transaction or custom handoff',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace(),
				own = yield* draft(t);
			yield* confirm(t, own.order);
			yield* t.runDue();
			expect((yield* t.as(t.admin).query('transactions', { all: true })).rows).toEqual([]);
		})
);
test.live('SQL invoices allow absent document files while retaining issued-evidence guards', () =>
	Effect.gen(function* () {
		const t = yield* workspace(),
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
					{ name: 'invoice.pdf', url: 'http://example.test/invoice.pdf', sha256: 'a'.repeat(64) }
				]
			},
			{
				documents: [
					{ name: 'invoice.pdf', url: 'https://example.test/invoice.pdf', sha256: 'invalid' }
				]
			},
			{ total: null },
			{ issued_on: null },
			{ ext_sales_order: null },
			{ source_updated_at: '2026-10-09T00:00:00Z' }
		])
			expect(
				yield* sync(t, 'transactions', [{ ...invoice.input, ...change }], 'upsert')
			).not.toMatchObject({ kind: 'committed' });
		expect(yield* t.as(t.admin).query('transactions', { id: invoice.id })).toMatchObject({
			total: decimalText('21.80'),
			issued_on: '2026-08-01',
			documents: []
		});
	})
);
test.live(
	'issued source deliveries and invoices remain visible when actual quantities exceed the forecast',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace(),
				own = yield* draft(t);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order);
			const invoice = yield* sourceTransaction(t, own, parent, 'invoice', '6');
			yield* sourceTransaction(t, own, parent, 'delivery', '12');
			expect(
				yield* t.as(t.admin).query('parties.progress', {
					party: fixtureId('parties', '00000000-0000-4000-8000-000000000101'),
					as_of: PlainDate('2026-10-10')
				})
			).toMatchObject([
				{
					quota: decimalText('10'),
					delivered: decimalText('12'),
					fulfillment: decimalText('120.00')
				}
			]);
			expect(
				yield* sync(t, 'transactions', [{ ...invoice.input, erp_id: 'extra' }], 'upsert')
			).toMatchObject({ kind: 'committed' });
		})
);
