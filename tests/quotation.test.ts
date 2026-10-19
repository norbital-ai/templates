import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { committed, confirm, draft, workspace } from './kit.js';
test.live(
	'quotation edits finalize the same order and line records, then pricing stays sealed',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const own = yield* draft(t);
			const before = yield* as.get('orders', own.order);
			expect(before?.status).toBe('draft');
			committed(
				'orders',
				yield* as.act('orders.update', {
					target: own.order,
					set: {
						payment_terms: 'Net 60',
						valid_from: PlainDate('2026-08-01'),
						valid_until: PlainDate('2026-12-31')
					}
				})
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.update', {
					target: own.line,
					set: { unit_price: Decimal.of('3') }
				})
			);
			const quoted = yield* as.query('orders.quotation_export', { order: own.order });
			expect(quoted.number).toBe(before?.number);
			expect(quoted.contract).toContain('Net 60');
			expect(quoted.contract).toContain('2026-08-01 – 2026-12-31');
			expect(quoted).not.toHaveProperty('seal_hash');
			yield* confirm(t, own.order);
			const after = yield* as.get('orders', own.order);
			expect(after?.sealed_contract).toBe(quoted.contract);
			expect(after?.id).toBe(before?.id);
			expect(after?.number).toBe(before?.number);
			expect(after?.sealed_contract).toContain('Net 60');
			expect(after?.sealed_snapshot).toMatchObject({
				valid_from: '2026-08-01',
				valid_until: '2026-12-31',
				lines: [expect.objectContaining({ id: own.line })]
			});
			expect(
				yield* Effect.flip(
					as.act('order_lines.update', { target: own.line, set: { unit_price: Decimal.of('4') } })
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect((yield* as.get('orders', own.order))?.seal_hash).toBe(after?.seal_hash);
		})
);
test.live('contract validity rejects reversed dates including a partial edit', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		const { order } = yield* draft(t);
		committed(
			'orders',
			yield* as.act('orders.update', {
				target: order,
				set: { valid_from: PlainDate('2026-08-01'), valid_until: PlainDate('2026-12-31') }
			})
		);
		expect(
			yield* Effect.flip(
				as.act('orders.update', { target: order, set: { valid_until: PlainDate('2026-07-31') } })
			)
		).toMatchObject({ _tag: 'ActRefused', message: 'errors.contract_validity' });
	})
);
