import { decimalText } from './test-runtime.js';
import { Effect } from 'effect';
import { expect, it } from '@effect/vitest';
import { workspace, draft, confirm } from './kit.js';
import { sourceOrder, sourceTransaction, sourcePayment, sync, writtenId } from './synced-kit.js';
import { agingOf, ledgerOf } from './reads.js';
it.live(
	'receipts replay once, refunds and withdrawals move the balance, deposits stay separate, and a void invoice takes no new payment',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace(),
				own = yield* draft(t),
				as = yield* t.as(t.admin);
			yield* confirm(t, own.order);
			const parent = yield* sourceOrder(t, own.order),
				invoice = yield* sourceTransaction(t, own, parent),
				delivery = yield* sourceTransaction(t, own, parent, 'delivery');
			const paid = yield* sourcePayment(t, parent, invoice.id, '10');
			expect(yield* sync(t, 'source_payments', [paid.input])).toMatchObject({
				kind: 'committed'
			});
			const refund = yield* sourcePayment(t, parent, invoice.id, '-2');
			const deposit = yield* sourcePayment(t, parent, null, '3');
			const aging = () =>
				agingOf(as, { as_of: '2026-10-10' }).pipe(
					Effect.map((rows) => rows.filter((row) => row.invoice === invoice.id))
				);
			expect(yield* aging()).toMatchObject([{ balance: decimalText('13.80') }]);
			expect(yield* ledgerOf(as, { order: own.order, unapplied: true })).toMatchObject([
				{ invoice: null, amount: decimalText('3') }
			]);
			// a receipt cannot apply to a delivery or go back to an older revision
			expect(
				yield* sync(t, 'source_payments', [{ ...deposit.input, invoice: delivery.id }])
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* sync(t, 'source_payments', [
					{ ...deposit.input, source_updated_at: '2026-10-09T00:00:00Z' }
				])
			).not.toMatchObject({ kind: 'committed' });
			writtenId(
				'source_payments',
				yield* sync(t, 'source_payments', [{ ...refund.input, active: false }])
			);
			expect(yield* aging()).toMatchObject([{ balance: decimalText('11.80') }]);
			writtenId(
				'transactions',
				yield* sync(t, 'transactions', [{ ...invoice.input, status: 'void' }])
			);
			expect(
				yield* sync(t, 'source_payments', [
					{ ...paid.input, external_code: 'new', reference: 'new' }
				])
			).not.toMatchObject({ kind: 'committed' });
			writtenId(
				'source_payments',
				yield* sync(t, 'source_payments', [{ ...paid.input, active: false }])
			);
			expect(yield* ledgerOf(as, { order: own.order, include_withdrawn: true })).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ source_payment: paid.id, state: 'withdrawn' }),
					expect.objectContaining({ source_payment: refund.id, state: 'withdrawn' })
				])
			);
		})
);
