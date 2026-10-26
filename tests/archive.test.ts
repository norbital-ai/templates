import { Effect } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { expect, it as test } from '@effect/vitest';
import { PRODUCT, committed, workspace, draft, confirm } from './kit.js';
import { sourceOrder, sourcePayment, sourceTransaction } from './synced-kit.js';

test.live('archiving retains the sealed contract, issued transactions and active payments', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		const own = yield* draft(t);
		yield* confirm(t, own.order);
		const before = yield* as.query('orders', { id: own.order });
		if (!before) throw new Error('Sealed contract required');
		const parent = yield* sourceOrder(t, own.order);
		const delivery = yield* sourceTransaction(t, own, parent, 'delivery');
		const invoice = yield* sourceTransaction(t, own, parent);
		const payment = yield* sourcePayment(t, parent, invoice.id, '2');
		const retained = yield* as.query({
			delivery: { from: 'transactions', id: delivery.id },
			invoice: { from: 'transactions', id: invoice.id },
			payment: { from: 'source_payments', id: payment.id },
			counterpart: { from: parent.collection, id: parent.id }
		});
		committed(
			'orders',
			yield* as.act('orders.update', { target: own.order, set: { archived: true } })
		);
		expect(yield* as.query('orders', { id: own.order })).toMatchObject({
			archived: true,
			status: 'confirmed',
			seal_hash: before.seal_hash,
			sealed_contract: before.sealed_contract,
			sealed_snapshot: before.sealed_snapshot
		});
		expect(
			yield* as.query({
				delivery: { from: 'transactions', id: delivery.id },
				invoice: { from: 'transactions', id: invoice.id },
				payment: { from: 'source_payments', id: payment.id },
				counterpart: { from: parent.collection, id: parent.id }
			})
		).toEqual(retained);
		committed(
			'orders',
			yield* as.act('orders.update', { target: own.order, set: { archived: false } })
		);
		expect(yield* as.query('orders', { id: own.order })).toMatchObject({
			archived: false,
			status: 'confirmed',
			seal_hash: before.seal_hash,
			sealed_snapshot: before.sealed_snapshot
		});
		expect(
			yield* as
				.act('order_lines.update', {
					target: own.line,
					set: { unit_price: Decimal.of(99) }
				})
				.pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActRefused' });
	})
);

test.live('an archived draft is read-only until unarchived and needs no status reason', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		const own = yield* draft(t);
		const line = yield* as.query('order_lines', { id: own.line });
		committed(
			'orders',
			yield* as.act('orders.update', { target: own.order, set: { archived: true } })
		);
		for (const set of [{ notes: 'Cannot edit archived remarks' }, { payment_terms: 'Net 90' }])
			expect(
				yield* as.act('orders.update', { target: own.order, set }).pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* as
				.act('order_lines.create', {
					order: own.order,
					product: PRODUCT,
					quantity: Decimal.of(1),
					unit_price: Decimal.of(2),
					tax_rate: Decimal.of(9)
				})
				.pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* as
				.act('order_lines.update', {
					target: own.line,
					set: { quantity: Decimal.of(12) }
				})
				.pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* as.act('order_lines.delete', { target: own.line }).pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(yield* confirm(t, own.order).pipe(Effect.flip)).toMatchObject({ _tag: 'ActRefused' });
		expect(yield* as.query('order_lines', { id: own.line })).toEqual(line);
		committed(
			'orders',
			yield* as.act('orders.update', { target: own.order, set: { archived: false } })
		);
		committed(
			'orders',
			yield* as.act('orders.update', {
				target: own.order,
				set: { notes: 'Customer may resume later' }
			})
		);
		committed(
			'order_lines',
			yield* as.act('order_lines.update', {
				target: own.line,
				set: { quantity: Decimal.of(12) }
			})
		);
		expect(yield* as.query('orders', { id: own.order })).toMatchObject({
			status: 'draft',
			archived: false,
			notes: 'Customer may resume later',
			seal_hash: null
		});
	})
);
