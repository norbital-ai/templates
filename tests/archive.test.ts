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
		const before = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
			.orders.rows[0];
		if (!before) throw new Error('Sealed contract required');
		const parent = yield* sourceOrder(t, own.order);
		const delivery = yield* sourceTransaction(t, own, parent, 'delivery');
		const invoice = yield* sourceTransaction(t, own, parent);
		const payment = yield* sourcePayment(t, parent, invoice.id, '2');
		// the retained evidence: both documents, the payment and the order's source counterpart
		const evidence = () =>
			as.query({
				transactions: { where: { id: { in: [delivery.id, invoice.id] } } },
				source_payments: { where: { id: { eq: payment.id } } },
				// a sales draft's counterpart is its source sales order
				ext_sales_orders: { where: { order: { eq: own.order } } }
			});
		const retained = yield* evidence();
		committed(
			'orders',
			yield* as.act('orders.update', [{ target: own.order, set: { archived: true } }])
		);
		expect(
			(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
		).toMatchObject({
			archived: true,
			status: 'confirmed',
			seal_hash: before.seal_hash,
			sealed_contract: before.sealed_contract,
			sealed_snapshot: before.sealed_snapshot
		});
		expect(yield* evidence()).toEqual(retained);
		committed(
			'orders',
			yield* as.act('orders.update', [{ target: own.order, set: { archived: false } }])
		);
		expect(
			(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
		).toMatchObject({
			archived: false,
			status: 'confirmed',
			seal_hash: before.seal_hash,
			sealed_snapshot: before.sealed_snapshot
		});
		expect(
			yield* as
				.act('order_lines.update', [
					{
						target: own.line,
						set: { unit_price: Decimal.of(99) }
					}
				])
				.pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActRefused' });
	})
);

test.live('an archived draft is read-only until unarchived and needs no status reason', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		const own = yield* draft(t);
		const line = (yield* as.query({ order_lines: { where: { id: { eq: own.line } }, limit: 1 } }))
			.order_lines.rows[0];
		committed(
			'orders',
			yield* as.act('orders.update', [{ target: own.order, set: { archived: true } }])
		);
		for (const set of [{ notes: 'Cannot edit archived remarks' }, { payment_terms: 'Net 90' }])
			expect(
				yield* as.act('orders.update', [{ target: own.order, set }]).pipe(Effect.flip)
			).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* as
				.act('order_lines.create', [
					{
						order: own.order,
						product: PRODUCT,
						quantity: Decimal.of(1),
						unit_price: Decimal.of(2),
						tax_rate: Decimal.of(9)
					}
				])
				.pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* as
				.act('order_lines.update', [
					{
						target: own.line,
						set: { quantity: Decimal.of(12) }
					}
				])
				.pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* as.act('order_lines.delete', [{ target: own.line }]).pipe(Effect.flip)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(yield* confirm(t, own.order).pipe(Effect.flip)).toMatchObject({ _tag: 'ActRefused' });
		expect(
			(yield* as.query({ order_lines: { where: { id: { eq: own.line } }, limit: 1 } })).order_lines
				.rows[0]
		).toEqual(line);
		committed(
			'orders',
			yield* as.act('orders.update', [{ target: own.order, set: { archived: false } }])
		);
		committed(
			'orders',
			yield* as.act('orders.update', [
				{
					target: own.order,
					set: { notes: 'Customer may resume later' }
				}
			])
		);
		committed(
			'order_lines',
			yield* as.act('order_lines.update', [
				{
					target: own.line,
					set: { quantity: Decimal.of(12) }
				}
			])
		);
		expect(
			(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
		).toMatchObject({
			status: 'draft',
			archived: false,
			notes: 'Customer may resume later',
			seal_hash: null
		});
	})
);
