import { decimalText } from './test-runtime.js';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace, draft, confirm } from './kit.js';
import {
	sourceOrder,
	sourceTransaction,
	sourcePayment,
	sync,
	writtenId,
	direct
} from './synced-kit.js';
test.live(
	'receipt replay counts once, refunds reduce payment, deposits stay separate and withdrawn facts are retained',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace(),
				own = yield* draft(t),
				as = t.as(t.admin);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order),
				invoice = yield* sourceTransaction(t, own, parent);
			const paid = yield* sourcePayment(t, parent, invoice.id, '10');
			expect(yield* sync(t, 'source_payments', [paid.input], 'upsert')).toMatchObject({
				kind: 'committed'
			});
			yield* sourcePayment(t, parent, invoice.id, '-2');
			yield* sourcePayment(t, parent, null, '3');
			expect(yield* as.query('orders.ar_aging', { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ invoice: invoice.id, balance: decimalText('13.80') }
			]);
			expect(yield* as.query('source_payments.ledger', { unapplied: true })).toMatchObject([
				{ invoice: null, amount: decimalText('3') }
			]);
			writtenId(
				'source_payments',
				yield* sync(t, 'source_payments', [{ ...paid.input, active: false }], 'upsert')
			);
			expect(yield* as.query('orders.ar_aging', { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ balance: decimalText('23.80') }
			]);
			expect(
				yield* as.query('source_payments.ledger', { order: own.order, include_withdrawn: true })
			).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ source_payment: paid.id, state: 'withdrawn' })
				])
			);
		})
);
test.live(
	'receipts are source-owned and cannot apply to a different agreement, a delivery or an older revision',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace(),
				own = yield* draft(t),
				other = yield* draft(t),
				as = t.as(t.admin);
			yield* confirm(t, own.order);
			yield* confirm(t, other.order);
			const parent = yield* sourceOrder(t, own.order),
				otherParent = yield* sourceOrder(t, other.order);
			const invoice = yield* sourceTransaction(t, other, otherParent),
				delivery = yield* sourceTransaction(t, own, parent, 'delivery');
			const paid = yield* sourcePayment(t, parent, null, '3');
			expect(
				yield* direct(t, as.authority, {
					collection: 'source_payments',
					verb: 'create',
					input: [paid.input]
				})
			).not.toMatchObject({ kind: 'committed' });
			for (const invoiceId of [invoice.id, delivery.id])
				expect(
					yield* sync(t, 'source_payments', [{ ...paid.input, invoice: invoiceId }], 'upsert')
				).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* sync(
					t,
					'source_payments',
					[{ ...paid.input, source_updated_at: '2026-10-09T00:00:00Z' }],
					'upsert'
				)
			).not.toMatchObject({ kind: 'committed' });
			expect(yield* as.get('source_payments', paid.id)).toMatchObject({
				invoice: null,
				amount: decimalText('3')
			});
		})
);
test.live(
	'an existing receipt can be withdrawn after its invoice is voided without accepting new payments against it',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace(),
				own = yield* draft(t);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order),
				invoice = yield* sourceTransaction(t, own, parent);
			const paid = yield* sourcePayment(t, parent, invoice.id, '3');
			writtenId(
				'transactions',
				yield* sync(t, 'transactions', [{ ...invoice.input, status: 'void' }], 'upsert')
			);
			expect(
				yield* sync(
					t,
					'source_payments',
					[{ ...paid.input, external_code: 'new', reference: 'new' }],
					'upsert'
				)
			).not.toMatchObject({ kind: 'committed' });
			writtenId(
				'source_payments',
				yield* sync(t, 'source_payments', [{ ...paid.input, active: false }], 'upsert')
			);
			expect(
				yield* t
					.as(t.admin)
					.query('source_payments.ledger', { order: own.order, include_withdrawn: true })
			).toMatchObject([{ invoice: invoice.id, state: 'withdrawn' }]);
		})
);
