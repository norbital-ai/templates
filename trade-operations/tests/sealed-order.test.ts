import { Decimal } from '@norbital-ai/std/decimal';
import { Effect } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace as acquireWorkspace, fixtureId } from './test-runtime.js';
import { committed } from './kit.js';
test.live('confirmation seals this SO and blocks all subsequent commercial edits', () =>
	Effect.gen(function* () {
		const t = yield* acquireWorkspace({ root: process.cwd(), now: '2026-10-10T00:00:00Z' });
		const as = t.as(t.admin);
		const order = committed(
			'orders',
			yield* as.act('orders.create', {
				title: 'Sealed SO',
				direction: 'sales',
				party: fixtureId('parties', '00000000-0000-4000-8000-000000000101'),
				currency: 'SGD',
				payment_terms: 'Net 30'
			})
		);
		const line = committed(
			'order_lines',
			yield* as.act('order_lines.create', {
				order,
				product: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
				quantity: Decimal.of('10'),
				unit_price: Decimal.of('2'),
				discount_pct: Decimal.of('0'),
				tax_rate: Decimal.of('9')
			})
		);
		const check = yield* as.query('orders.confirmation_check', { order });
		expect(check).toHaveProperty('check_hash');
		const checked = check;
		committed(
			'orders',
			yield* as.act('orders.update', {
				target: order,
				set: { status: 'confirmed', check_hash: checked.check_hash }
			})
		);
		const before = yield* as.get('orders', order);
		expect(before).toMatchObject({ status: 'confirmed', sealed_contract_version: '1' });
		expect(before?.sealed_snapshot).toMatchObject({ total: '21.80', payment_terms: 'Net 30' });
		expect(before?.sealed_contract).toContain('Net 30');
		expect(before?.sealed_contract).toContain(before?.number);
		expect(before?.sealed_contract).not.toContain(order);
		expect(
			yield* Effect.flip(
				as.act('orders.update', { target: order, set: { payment_terms: 'Net 90' } })
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(
			yield* Effect.flip(
				as.act('order_lines.update', { target: line, set: { unit_price: Decimal.of('99') } })
			)
		).toMatchObject({ _tag: 'ActRefused' });
		expect(yield* Effect.flip(as.act('order_lines.delete', { target: line }))).toMatchObject({
			_tag: 'ActRefused'
		});
		const nextTemplate = committed(
			'document_templates',
			yield* as.act('document_templates.create', {
				kind: 'contract',
				locale: 'en',
				version: '2',
				title: 'New terms',
				body: '{agreement}\nNew contract wording'
			})
		);
		committed(
			'document_templates',
			yield* as.act('document_templates.update', {
				target: nextTemplate,
				set: { status: 'published' }
			})
		);
		const after = yield* as.get('orders', order);
		expect(after?.seal_hash).toEqual(before?.seal_hash);
		expect(after?.sealed_snapshot).toEqual(before?.sealed_snapshot);
		expect(after?.sealed_contract).toEqual(before?.sealed_contract);
	})
);
test.live('a credit acknowledgment cannot confirm changed pricing or another SO', () =>
	Effect.gen(function* () {
		const t = yield* acquireWorkspace({ root: process.cwd(), now: '2026-10-10T00:00:00Z' });
		const as = t.as(t.admin);
		const createOrder = Effect.fnUntraced(function* (title: string) {
			return committed(
				'orders',
				yield* as.act('orders.create', {
					title,
					direction: 'sales',
					party: fixtureId('parties', '00000000-0000-4000-8000-000000000101'),
					currency: 'SGD',
					payment_terms: 'Net 30'
				})
			);
		});
		const first = yield* createOrder('First SO');
		const second = yield* createOrder('Second SO');
		const line = committed(
			'order_lines',
			yield* as.act('order_lines.create', {
				order: first,
				product: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
				quantity: Decimal.of('10'),
				unit_price: Decimal.of('2'),
				discount_pct: Decimal.of('0'),
				tax_rate: Decimal.of('9')
			})
		);
		committed(
			'order_lines',
			yield* as.act('order_lines.create', {
				order: second,
				product: fixtureId('products', '00000000-0000-4000-8000-000000000201'),
				quantity: Decimal.of('10'),
				unit_price: Decimal.of('2'),
				discount_pct: Decimal.of('0'),
				tax_rate: Decimal.of('9')
			})
		);
		const check = yield* as.query('orders.confirmation_check', { order: first });
		expect(
			yield* Effect.flip(
				as.act('orders.update', {
					target: second,
					set: { status: 'confirmed', check_hash: check.check_hash }
				})
			)
		).toMatchObject({ _tag: 'ActRefused', message: 'errors.check_changed' });
		committed(
			'order_lines',
			yield* as.act('order_lines.update', { target: line, set: { unit_price: Decimal.of('3') } })
		);
		expect(
			yield* Effect.flip(
				as.act('orders.update', {
					target: first,
					set: { status: 'confirmed', check_hash: check.check_hash }
				})
			)
		).toMatchObject({ _tag: 'ActRefused', message: 'errors.check_changed' });
		const refreshed = yield* as.query('orders.confirmation_check', { order: first });
		committed(
			'orders',
			yield* as.act('orders.update', {
				target: first,
				set: { status: 'confirmed', check_hash: refreshed.check_hash }
			})
		);
		expect(yield* as.get('orders', first)).toMatchObject({ sealed_snapshot: { total: '32.70' } });
		expect(yield* as.get('orders', second)).toMatchObject({
			status: 'draft',
			sealed_snapshot: null,
			seal_hash: null
		});
	})
);
