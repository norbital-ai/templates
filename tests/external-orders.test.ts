import { fixtureId } from './test-runtime.js';
import { firstRow } from './test-runtime.js';
import { Context, Effect } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import { Identity, Writes, type Json } from '@norbital-ai/bolt/engine';
import { randomUUID } from 'node:crypto';
import { expect, it as test } from '@effect/vitest';
import { workspace, draft, confirm, type T } from './kit.js';
import { writtenId, direct } from './synced-kit.js';
const NOW = '2026-10-10T00:00:00Z';
const write = Effect.fnUntraced(function* (
	t: T,
	collection: 'ext_sales_orders' | 'ext_purchase_orders' | 'transactions',
	input: Record<string, Json> | Record<string, Json>[],
	verb: 'create' | 'upsert' = 'create',
	fed = true
) {
	const key = randomUUID();
	const authority = yield* Context.get(t.services, Identity).authority({
		actor: {
			kind: 'system',
			run: key,
			by: { integration: 'kingdee', instance: 'kingdee', feed: collection }
		},
		policies: [],
		admin: false
	});
	return (yield* Context.get(t.services, Writes).act({
		collection,
		verb,
		input: (Array.isArray(input) ? input : [input]).map((row) => ({
			...row,
			source: 'kingdee'
		})),
		key,
		issuedAt: NOW,
		authority,
		bindings: { now: NOW, today: '2026-10-10', tz: 'Asia/Singapore', params: {} },
		invocationId: key,
		...(verb === 'upsert' ? { onConflict: 'update' as const } : {}),
		mode: fed
			? {
					_tag: 'Feed',
					fields: [...Object.keys((Array.isArray(input) ? input[0] : input) ?? {}), 'source'],
					removals: [],
					pieces: () => {}
				}
			: { _tag: 'Direct' }
	})).outcome;
});
const receipt = Effect.fnUntraced(function* (
	t: T,
	_name: 'ext_sales_orders' | 'ext_purchase_orders',
	order: Id<'orders'>,
	external_id: string = randomUUID()
) {
	const seal = yield* t.as(t.admin).get('orders', order);
	return {
		order,
		external_id,
		reference: 'SOURCE-1',
		agreement_hash: String(seal?.seal_hash),
		currency: 'SGD',
		status: 'issued',
		source_updated_at: NOW
	};
});
test.live(
	'source confirmations require the correct sealed sales/purchase agreement and are read-only even for administrators',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const so = yield* draft(t),
				po = yield* draft(t, 'purchasing');
			yield* confirm(t, so.order);
			yield* confirm(t, po.order);
			const sales = yield* receipt(t, 'ext_sales_orders', so.order);
			const purchase = yield* receipt(t, 'ext_purchase_orders', po.order);
			// only the feed's own page writes a fed collection, whatever the actor
			expect(yield* write(t, 'ext_sales_orders', sales, 'create', false)).toMatchObject({
				kind: 'refused',
				code: 'forbidden'
			});
			const id = writtenId('ext_sales_orders', yield* write(t, 'ext_sales_orders', sales));
			expect(yield* write(t, 'ext_purchase_orders', purchase)).toMatchObject({ kind: 'committed' });
			expect(
				yield* write(t, 'ext_sales_orders', {
					...sales,
					external_id: 'wrong-type',
					order: po.order
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* write(t, 'ext_sales_orders', {
					...sales,
					external_id: 'wrong-seal',
					agreement_hash: 'wrong'
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* direct(t, t.as(t.admin).authority, {
					collection: 'ext_sales_orders',
					verb: 'create',
					input: [{ ...sales, external_id: 'manual' }]
				})
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* direct(t, t.as(t.admin).authority, {
					collection: 'ext_sales_orders',
					verb: 'update',
					input: [{ target: id, set: { reference: 'manual edit' } }]
				})
			).not.toMatchObject({ kind: 'committed' });
		})
);
test.live(
	'source confirmation identity and agreement cannot be relinked through an integration upsert',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const first = yield* draft(t),
				second = yield* draft(t);
			yield* confirm(t, first.order);
			yield* confirm(t, second.order);
			const row = yield* receipt(t, 'ext_sales_orders', first.order, 'SAME-SOURCE-ID');
			writtenId('ext_sales_orders', yield* write(t, 'ext_sales_orders', row));
			const foreign = yield* receipt(t, 'ext_sales_orders', second.order, row.external_id);
			expect(yield* write(t, 'ext_sales_orders', [foreign], 'upsert')).not.toMatchObject({
				kind: 'committed'
			});
			expect((yield* t.as(t.admin).read('ext_sales_orders', { all: true })).rows[0]?.order).toBe(
				first.order
			);
		})
);
test.live(
	'transactions require an issued external parent from the same agreement and preserve that parent',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const own = yield* draft(t),
				foreign = yield* draft(t);
			yield* confirm(t, own.order);
			yield* confirm(t, foreign.order);
			const parent = writtenId(
				'ext_sales_orders',
				yield* write(t, 'ext_sales_orders', yield* receipt(t, 'ext_sales_orders', own.order))
			);
			const other = writtenId(
				'ext_sales_orders',
				yield* write(t, 'ext_sales_orders', yield* receipt(t, 'ext_sales_orders', foreign.order))
			);
			const sibling = writtenId(
				'ext_sales_orders',
				yield* write(t, 'ext_sales_orders', yield* receipt(t, 'ext_sales_orders', own.order))
			);
			const order = yield* t.as(t.admin).get('orders', own.order);
			const row = {
				erp_id: 'INV-1',
				order: own.order,
				ext_sales_order: parent,
				kind: 'invoice',
				issued_on: '2026-10-10',
				total: '8.00',
				reference: 'INV-1',
				seal_hash: String(order?.seal_hash),
				currency: 'SGD',
				status: 'issued',
				items: [
					{
						order_line_id: own.line,
						product_name: 'Resin A',
						unit: 'kg',
						quantity: '4',
						unit_price: '2'
					}
				],
				documents: [
					{
						name: 'Invoice.pdf',
						url: 'https://source.example.test/invoice.pdf',
						sha256: 'a'.repeat(64)
					}
				],
				source_updated_at: NOW
			};
			expect(
				yield* write(t, 'transactions', [{ ...row, documents: [] }], 'upsert')
			).not.toMatchObject({
				kind: 'committed'
			});
			expect(
				yield* write(
					t,
					'transactions',
					[{ ...row, items: [{ ...firstRow(row.items), unit_price: '99' }] }],
					'upsert'
				)
			).not.toMatchObject({ kind: 'committed' });
			writtenId('transactions', yield* write(t, 'transactions', [row], 'upsert'));
			expect(
				yield* write(t, 'transactions', [{ ...row, ext_sales_order: other }], 'upsert')
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* write(t, 'transactions', [{ ...row, ext_sales_order: sibling }], 'upsert')
			).not.toMatchObject({ kind: 'committed' });
			expect(
				yield* write(t, 'transactions', [{ ...row, ext_sales_order: null }], 'upsert')
			).not.toMatchObject({ kind: 'committed' });
			expect(yield* write(t, 'transactions', [row], 'upsert', false)).toMatchObject({
				kind: 'refused',
				code: 'forbidden'
			});
			expect(
				(yield* t
					.as(t.admin)
					.read('transactions', { where: { erp_id: { eq: 'INV-1' } }, all: true })).rows[0]
					?.ext_sales_order
			).toBe(parent);
		})
);
test.live('external confirmations follow sales/procurement order ownership', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const sales = t.member(['sales']),
			other = t.member(['sales']),
			purchasing = t.member(['procurement']);
		if (sales.actor.kind !== 'member' || purchasing.actor.kind !== 'member')
			throw new Error('Member required');
		const so = yield* draft(t, 'sales', fixtureId('sys_user', sales.actor.id)),
			po = yield* draft(t, 'purchasing', fixtureId('sys_user', purchasing.actor.id));
		yield* confirm(t, so.order);
		yield* confirm(t, po.order);
		writtenId(
			'ext_sales_orders',
			yield* write(t, 'ext_sales_orders', yield* receipt(t, 'ext_sales_orders', so.order))
		);
		writtenId(
			'ext_purchase_orders',
			yield* write(t, 'ext_purchase_orders', yield* receipt(t, 'ext_purchase_orders', po.order))
		);
		expect((yield* t.as(sales).read('ext_sales_orders', { all: true })).rows).toHaveLength(1);
		expect((yield* t.as(other).read('ext_sales_orders', { all: true })).rows).toHaveLength(0);
		expect((yield* t.as(purchasing).read('ext_purchase_orders', { all: true })).rows).toHaveLength(
			1
		);
	})
);
for (const direction of ['sales', 'purchasing'] as const) {
	test.live(
		`${direction} transaction cancellation preserves its link after its external parent is void`,
		() =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const local = yield* draft(t, direction);
				yield* confirm(t, local.order);
				const collection = direction === 'sales' ? 'ext_sales_orders' : 'ext_purchase_orders';
				const source = yield* receipt(t, collection, local.order);
				const parent = writtenId(collection, yield* write(t, collection, source));
				const row = {
					erp_id: 'CANCEL-1',
					order: local.order,
					...(direction === 'sales' ? { ext_sales_order: parent } : { ext_purchase_order: parent }),
					kind: 'delivery',
					reference: 'DO-1',
					seal_hash: source.agreement_hash,
					currency: 'SGD',
					status: 'issued',
					items: [
						{
							order_line_id: local.line,
							product_name: 'Resin A',
							unit: 'kg',
							quantity: '4',
							unit_price: '2'
						}
					],
					documents: [
						{
							name: 'Delivery.pdf',
							url: 'https://source.example.test/delivery.pdf',
							sha256: 'a'.repeat(64)
						}
					],
					source_updated_at: NOW
				};
				writtenId('transactions', yield* write(t, 'transactions', [row], 'upsert'));
				writtenId(
					collection,
					yield* write(t, collection, [{ ...source, status: 'void' }], 'upsert')
				);
				writtenId(
					'transactions',
					yield* write(t, 'transactions', [{ ...row, status: 'void' }], 'upsert')
				);
				expect(yield* write(t, 'transactions', [row], 'upsert')).not.toMatchObject({
					kind: 'committed'
				});
				const saved = (yield* t
					.as(t.admin)
					.read('transactions', { where: { erp_id: { eq: row.erp_id } }, all: true })).rows[0];
				expect(saved?.status).toBe('void');
				expect(direction === 'sales' ? saved?.ext_sales_order : saved?.ext_purchase_order).toBe(
					parent
				);
			})
	);
}
