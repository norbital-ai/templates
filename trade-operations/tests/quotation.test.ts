import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { Effect, Result } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { committed, confirm, draft, PRODUCT, SETTINGS, workspace } from './kit.js';
import { quotationOf } from './reads.js';
import { confirmationCheck, confirmationHash, confirmationRead } from '../src/lib/confirmation.js';
test.live(
	'quotation edits finalize the same order and line records, then pricing stays sealed',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const own = yield* draft(t);
			const before = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
				.orders.rows[0];
			expect(before?.status).toBe('draft');
			committed(
				'orders',
				yield* as.act('orders.update', [
					{
						target: own.order,
						set: {
							payment_terms: 'Net 60',
							valid_from: PlainDate('2026-08-01'),
							valid_until: PlainDate('2026-12-31')
						}
					}
				])
			);
			committed(
				'order_lines',
				yield* as.act('order_lines.update', [
					{
						target: own.line,
						set: { unit_price: Decimal.of('3') }
					}
				])
			);
			const quoted = yield* quotationOf(as, { order: own.order });
			expect(quoted.number).toBe(before?.number);
			expect(quoted.contract).toContain('Net 60');
			expect(quoted.contract).toContain('2026-08-01 – 2026-12-31');
			expect(quoted).not.toHaveProperty('seal_hash');
			yield* confirm(t, own.order);
			const after = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
				.orders.rows[0];
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
					as.act('order_lines.update', [{ target: own.line, set: { unit_price: Decimal.of('4') } }])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				(yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } })).orders.rows[0]
					?.seal_hash
			).toBe(after?.seal_hash);
		})
);
test.live('contract validity rejects reversed dates including a partial edit', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = t.as(t.admin);
		const { order } = yield* draft(t);
		committed(
			'orders',
			yield* as.act('orders.update', [
				{
					target: order,
					set: { valid_from: PlainDate('2026-08-01'), valid_until: PlainDate('2026-12-31') }
				}
			])
		);
		expect(
			yield* Effect.flip(
				as.act('orders.update', [{ target: order, set: { valid_until: PlainDate('2026-07-31') } }])
			)
		).toMatchObject({ _tag: 'ActRefused', message: 'errors.contract_validity' });
	})
);

test.live(
	'drafts show the current net floor and an enforced floor protects the sealed commission basis',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = t.as(t.admin);
			const warehouse = (yield* as.query({
				warehouses: { where: { external_code: { eq: 'WEST' } }, limit: 1 }
			})).warehouses.rows[0];
			const group = warehouse?.group_code;
			if (!warehouse || !group) throw new Error('Fixture warehouse group missing');
			const { order, line } = yield* draft(t, 'sales', undefined, '2026-08-01', warehouse.id);
			committed(
				'pricing_floors',
				yield* as.act('pricing_floors.create', [
					...['2026-07-01', '2026-08-02'].map((day, index) => ({
						product: PRODUCT,
						currency: 'SGD' as const,
						unit: 'kg',
						group_code: group,
						effective_on: PlainDate(day),
						floor_price: Decimal.of(index === 0 ? '3.27' : '5.45'),
						tax_inclusive: true,
						tax_rate: Decimal.of(9),
						minimum_quantity: Decimal.of(0)
					}))
				])
			);
			committed(
				'commercial_settings',
				yield* as.act('commercial_settings.update', [
					{ target: SETTINGS, set: { require_floor: true } }
				])
			);
			const read = () => as.query(confirmationRead(order));
			const check = confirmationCheck(yield* read(), { as_of: '2026-08-02T00:00:00Z' });
			if (Result.isFailure(check)) throw new Error(check.failure);
			expect(check.success.floors[0]?.net?.eq(3)).toBe(true);
			expect(check.success.floors[0]?.effective_on).toBe('2026-07-01');
			expect(check.success.floors[0]?.below).toBe(true);
			const check_hash = yield* confirmationHash(check.success);
			expect(
				yield* Effect.flip(
					as.act('orders.update', [{ target: order, set: { status: 'confirmed', check_hash } }])
				)
			).toMatchObject({ message: 'errors.floor_below' });
			committed(
				'order_lines',
				yield* as.act('order_lines.update', [{ target: line, set: { unit_price: Decimal.of(4) } }])
			);
			yield* confirm(t, order);
			expect((yield* read()).orders.rows[0]?.sealed_snapshot?.lines[0]?.floor_net).toBe(
				'3.00000000'
			);
		})
);
