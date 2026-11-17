import { sameDecimal, type Typed } from './test-runtime.js';
import { Effect, Result } from 'effect';
import { expect, it as test } from '@effect/vitest';
import type { Id, ReadAnswer } from '@norbital-ai/bolt';
import { committed, confirm, draft, PRODUCT, SETTINGS, workspace } from './kit.js';
import { confirmationReadOf, documentOf } from './reads.js';
import { businessRows } from './business-source.js';
import {
	configurationRead,
	confirmationCheck,
	confirmationHash,
	confirmationRead,
	confirmationScopeRead
} from '../src/lib/confirmation.js';
test.live('quotation edits confirm the same order and line records', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = yield* t.as(t.admin);
		const own = yield* draft(t);
		const before = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
			.orders.rows[0];
		expect(before?.status).toBe('draft');
		committed(
			'orders',
			yield* as.act({
				'orders.update': [
					{
						target: yield* t.at('orders', own.order),
						set: {
							payment_terms: 'Net 60',
							valid_from: '2026-08-01',
							valid_until: '2026-12-31'
						}
					}
				]
			})
		);
		committed(
			'order_lines',
			yield* as.act({
				'order_lines.update': [
					{ target: yield* t.at('order_lines', own.line), set: { unit_price: '3' } }
				]
			})
		);
		// the draft's document is its quotation: the saved terms, unsealed
		const quoted = yield* documentOf(as, { order: own.order });
		expect(quoted.reference).toBe(before?.number);
		expect(quoted.filename).toMatch(/-(quotation|draft)\.pdf$/);
		expect(quoted.html).toContain('Net 60');
		expect(quoted.html).toContain('2026-08-01');
		expect(quoted.html).toContain('2026-12-31');
		yield* confirm(t, own.order);
		const after = (yield* as.query({ orders: { where: { id: { eq: own.order } }, limit: 1 } }))
			.orders.rows[0];
		expect(after).toMatchObject({
			id: before?.id,
			number: before?.number,
			status: 'confirmed',
			payment_terms: 'Net 60',
			valid_from: '2026-08-01',
			valid_until: '2026-12-31'
		});
		expect(
			(yield* as.query({ order_lines: { where: { order: { eq: own.order } } } })).order_lines.rows
		).toMatchObject([{ id: own.line }]);
	})
);
test.live('contract validity rejects reversed dates including a partial edit', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = yield* t.as(t.admin);
		const { order } = yield* draft(t);
		committed(
			'orders',
			yield* as.act({
				'orders.update': [
					{
						target: yield* t.at('orders', order),
						set: { valid_from: '2026-08-01', valid_until: '2026-12-31' }
					}
				]
			})
		);
		expect(
			yield* Effect.flip(
				as.act({
					'orders.update': [
						{ target: yield* t.at('orders', order), set: { valid_until: '2026-07-31' } }
					]
				})
			)
		).toMatchObject({ _tag: 'ActRefused', key: 'errors.contract_validity' });
	})
);

test.live(
	'drafts show the current net floor and an enforced floor protects the commission basis',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const as = yield* t.as(t.admin);
			const warehouse = (yield* as.query({
				warehouses: { where: { external_code: { eq: 'WEST' } }, limit: 1 }
			})).warehouses.rows[0];
			const group = warehouse?.group_code;
			if (!warehouse || !group) throw new Error('Fixture warehouse group missing');
			const { order, line } = yield* draft(t, 'sales', undefined, '2026-08-01', warehouse.id);
			const other = (yield* as.query({ products: { where: { id: { ne: PRODUCT } }, limit: 1 } }))
				.products.rows[0];
			if (!other) throw new Error('Second fixture product missing');
			yield* businessRows(
				t,
				'stock_snapshots',
				[
					{ product_code: 'RESIN-A', external_code: 'own-lot' },
					{ product_code: other.external_code, external_code: 'other-lot' }
				].map((row) => ({
					...row,
					warehouse_code: 'WEST',
					lot_number: row.external_code,
					currency: 'SGD',
					unit: 'kg',
					on_hand: '10',
					unit_cost: '2.5',
					as_of: '2026-08-01T00:00:00Z'
				}))
			);
			committed(
				'pricing_floors',
				yield* as.act({
					'pricing_floors.create': [
						...['2026-07-01', '2026-08-02'].map((day, index) => ({
							product: PRODUCT,
							currency: 'SGD' as const,
							unit: 'kg',
							group_code: group,
							effective_on: day,
							floor_price: index === 0 ? '3.27' : '5.45',
							tax_inclusive: true,
							tax_rate: '9',
							minimum_quantity: '0'
						})),
						...[
							{ product: other.id, currency: 'SGD' as const },
							{ product: PRODUCT, currency: 'USD' as const }
						].map((row) => ({
							...row,
							unit: 'kg',
							group_code: group,
							effective_on: '2026-07-01',
							floor_price: '99',
							tax_inclusive: false,
							tax_rate: '0',
							minimum_quantity: '0'
						}))
					]
				})
			);
			committed(
				'commercial_settings',
				yield* as.act({
					'commercial_settings.update': [
						{ target: yield* t.at('commercial_settings', SETTINGS), set: { require_floor: true } }
					]
				})
			);
			const read = () => confirmationReadOf(as, order);
			const scoped = yield* read();
			const at = { as_of: '2026-08-02T00:00:00Z' };
			const configuration = yield* as.query(configurationRead);
			const check = confirmationCheck(scoped, configuration, at);
			expect(scoped.pricing_floors.rows).toHaveLength(1);
			expect(scoped.warehouses.rows).toHaveLength(1);
			expect(scoped.stock_snapshots.rows).toHaveLength(1);
			const scope = (yield* as.query(confirmationScopeRead(order))).orders.rows[0];
			if (!scope) throw new Error('Draft scope missing');
			const request = confirmationRead(scope);
			const broad = yield* as.query({
				...request,
				stock_snapshots: { ...request.stock_snapshots, where: {} },
				pricing_floors: {},
				warehouses: {}
			});
			expect(broad.pricing_floors.rows).toHaveLength(4);
			expect(broad.stock_snapshots.rows).toHaveLength(2);
			expect(confirmationCheck(broad, configuration, at)).toEqual(check);
			if (Result.isFailure(check)) throw new Error(check.failure);
			expect(sameDecimal(check.success.floors[0]?.net, '3')).toBe(true);
			// the hashed terms carry the floor's own net of tax, as the model computes it
			const floor = (yield* read()).pricing_floors.rows.find(
				(row) => row.effective_on === '2026-07-01'
			);
			expect(sameDecimal(floor?.floor_net, '3')).toBe(true);
			expect(check.success.basis.terms.lines[0]?.floor_net).toBe(floor?.floor_net);
			expect(check.success.floors[0]?.effective_on).toBe('2026-07-01');
			expect(check.success.floors[0]?.below).toBe(true);
			const check_hash = yield* confirmationHash(check.success);
			expect(
				yield* Effect.flip(
					as.act({
						'orders.update': [
							{ target: yield* t.at('orders', order), set: { status: 'confirmed', check_hash } }
						]
					})
				)
			).toMatchObject({ key: 'errors.floor_below' });
			committed(
				'order_lines',
				yield* as.act({
					'order_lines.update': [
						{ target: yield* t.at('order_lines', line), set: { unit_price: '4' } }
					]
				})
			);
			yield* confirm(t, order);
			expect(sameDecimal((yield* read()).orders.rows[0]?.lines[0]?.floor_net, '3')).toBe(true);
			expect((yield* as.query(request)).orders.rows).toEqual([]);
		})
);

/** A draft's confirmation check against one configuration answer, with the hash its confirmation sends. */
const checkedWith = Effect.fnUntraced(function* (
	as: Typed,
	order: Id<'orders'>,
	configuration: ReadAnswer<typeof configurationRead>,
	as_of: string
) {
	const check = confirmationCheck(yield* confirmationReadOf(as, order), configuration, { as_of });
	if (Result.isFailure(check)) throw new Error(check.failure);
	return { ...check.success, check_hash: yield* confirmationHash(check.success) };
});

test.live('open drafts check against one configuration read that names no order', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = yield* t.as(t.admin);
		const first = yield* draft(t);
		const second = yield* draft(t);
		for (const { order } of [first, second]) {
			const scope = (yield* as.query(confirmationScopeRead(order))).orders.rows[0];
			if (!scope) throw new Error('Draft scope missing');
			expect(confirmationRead(scope)).not.toHaveProperty('document_templates');
			expect(confirmationRead(scope)).not.toHaveProperty('commercial_settings');
		}
		const configuration = yield* as.query(configurationRead);
		const one = yield* checkedWith(as, first.order, configuration, t.clock.now());
		const two = yield* checkedWith(as, second.order, configuration, t.clock.now());
		expect(one.basis.terms.order_id).toBe(first.order);
		expect(two.basis.terms.order_id).toBe(second.order);
		expect(one.basis.settings).toEqual(two.basis.settings);
		expect(one.basis.template).toEqual(two.basis.template);
		for (const [order, check] of [
			[first.order, one],
			[second.order, two]
		] as const)
			committed(
				'orders',
				yield* as.act({
					'orders.update': [
						{
							target: yield* t.at('orders', order),
							set: { status: 'confirmed', check_hash: check.check_hash }
						}
					]
				})
			);
	})
);

test.live('a configuration edit and a published template reach every draft sharing the read', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = yield* t.as(t.admin);
		const drafts = [yield* draft(t), yield* draft(t)];
		const before = yield* as.query(configurationRead);
		committed(
			'commercial_settings',
			yield* as.act({
				'commercial_settings.update': [
					{
						target: yield* t.at('commercial_settings', SETTINGS),
						set: { credit_fresh_minutes: 90 }
					}
				]
			})
		);
		const template = committed(
			'document_templates',
			yield* as.act({
				'document_templates.create': [
					{ locale: 'en', version: '2', title: 'Revised agreement', body: '{agreement}' }
				]
			})
		);
		committed(
			'document_templates',
			yield* as.act({
				'document_templates.update': [
					{ target: yield* t.at('document_templates', template), set: { status: 'published' } }
				]
			})
		);
		const after = yield* as.query(configurationRead);
		expect(before.document_templates.rows.map((row) => row.id)).not.toContain(template);
		expect(after.document_templates.rows.map((row) => row.id)).toContain(template);
		for (const { order } of drafts) {
			const stale = yield* checkedWith(as, order, before, t.clock.now());
			const current = yield* checkedWith(as, order, after, t.clock.now());
			expect(stale.basis.settings.credit_fresh_minutes).toBe(60);
			expect(current.basis.settings.credit_fresh_minutes).toBe(90);
			expect(current.basis.settings.revision).toBeGreaterThan(stale.basis.settings.revision);
			expect(current.check_hash).not.toBe(stale.check_hash);
		}
	})
);

test.live('a confirmation checked against replaced rules cannot commit', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const as = yield* t.as(t.admin);
		const { order } = yield* draft(t);
		const stale = yield* checkedWith(as, order, yield* as.query(configurationRead), t.clock.now());
		committed(
			'commercial_settings',
			yield* as.act({
				'commercial_settings.update': [
					{ target: yield* t.at('commercial_settings', SETTINGS), set: { require_floor: true } }
				]
			})
		);
		const confirmWith = Effect.fnUntraced(function* (check_hash: string) {
			return yield* Effect.flip(
				as.act({
					'orders.update': [
						{
							target: yield* t.at('orders', order),
							set: { status: 'confirmed', check_hash }
						}
					]
				})
			);
		});
		expect(yield* confirmWith(stale.check_hash)).toMatchObject({
			_tag: 'ActRefused',
			key: 'errors.check_changed'
		});
		const current = yield* checkedWith(
			as,
			order,
			yield* as.query(configurationRead),
			t.clock.now()
		);
		expect(current.basis.settings.require_floor).toBe(true);
		// the draft has no floor, so the rule the stale check missed now refuses it
		expect(yield* confirmWith(current.check_hash)).toMatchObject({
			_tag: 'ActRefused',
			key: 'errors.floor_missing'
		});
	})
);
