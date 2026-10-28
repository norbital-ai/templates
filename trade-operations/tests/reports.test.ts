import { decimalText } from './test-runtime.js';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { sourceOrder, sourceTransaction, sourcePayment } from './synced-kit.js';
import { expect, it as test } from '@effect/vitest';
import { committed, workspace, draft, confirm } from './kit.js';
import { agingOf } from './reads.js';
test.live(
	'AR separates applied payments, unapplied deposits, overdue buckets and overpayments',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const { order, line } = yield* draft(t);
			yield* confirm(t, order);
			const as = t.as(t.admin);
			const parent = yield* sourceOrder(t, order);
			const invoice = yield* sourceTransaction(t, { order, line }, parent);
			yield* sourcePayment(t, parent, invoice.id, '5');
			yield* sourcePayment(t, parent, null, '3');
			expect(yield* agingOf(as, { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ balance: decimalText('16.80'), bucket: '61_90', overpaid: decimalText('0') }
			]);
			yield* sourcePayment(t, parent, invoice.id, '20');
			committed(
				'orders',
				yield* as.act('orders.update', [{ target: order, set: { archived: true } }])
			);
			expect(yield* agingOf(as, { as_of: PlainDate('2026-10-10') })).toMatchObject([
				{ balance: decimalText('0'), overpaid: decimalText('3.20') }
			]);
		})
);
