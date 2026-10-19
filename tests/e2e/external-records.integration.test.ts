// @vitest-environment happy-dom
import { vi, expect, it as test } from '@effect/vitest';
import { Schema, Effect } from 'effect';
import { flushSync } from 'svelte';
import type { ShellMountConfig } from '@norbital-ai/bolt/test/browser';
import type { Json } from '@norbital-ai/bolt/engine';
import { workspace, draft, confirm } from '../kit.js';
import { sync, writtenId } from '../synced-kit.js';
import { open } from './open.js';
type Loader = NonNullable<ShellMountConfig['representations']>[string];
const loads = import.meta.glob<Awaited<ReturnType<Loader>>>(
	'../../src/data/collection/**/+representation.svelte'
);
const representations = Object.fromEntries(
	Object.entries(loads).map(([path, load]) => [
		path.replace('../../src/data/collection/', '').replace('/+representation.svelte', ''),
		load
	])
);
for (const collection of ['ext_sales_orders', 'ext_purchase_orders', 'transactions'] as const) {
	test.live.each(['en', 'zh'])(
		`%s: ${collection} detail is read-only and displays selected history`,
		(locale) =>
			Effect.gen(function* () {
				const t = yield* workspace();
				const local = yield* draft(
					t,
					collection === 'ext_purchase_orders' ? 'purchasing' : 'sales'
				);
				yield* confirm(t, local.order);
				const order = yield* t.as(t.admin).get('orders', local.order);
				const write = Effect.fnUntraced(function* (
					of: typeof collection,
					input: Record<string, Json>
				) {
					return writtenId(of, yield* sync(t, of, [input], 'upsert'));
				});
				const source = {
					order: local.order,
					external_id: 'SOURCE-1',
					reference: 'SOURCE-OLD',
					agreement_hash: String(order?.seal_hash),
					currency: 'SGD',
					status: 'issued'
				};
				let row: Record<string, Json> = source;
				if (collection === 'transactions') {
					const parent = yield* write('ext_sales_orders', source);
					row = {
						order: local.order,
						erp_id: 'INV-1',
						reference: 'SOURCE-OLD',
						ext_sales_order: parent,
						kind: 'invoice',
						issued_on: '2026-10-10',
						total: '8.00',
						currency: 'SGD',
						seal_hash: String(order?.seal_hash),
						status: 'issued',
						items: [
							{
								order_line_id: local.line,
								product_name: 'Resin A',
								quantity: '4',
								unit: 'kg',
								unit_price: '2'
							}
						],
						documents: [
							{
								name: 'Old invoice.pdf',
								url: 'https://source.example.test/old.pdf',
								sha256: 'a'.repeat(64)
							}
						]
					};
				}
				const id = yield* write(collection, row);
				yield* write(collection, {
					...row,
					reference: 'SOURCE-NEW',
					...(collection === 'transactions'
						? {
								documents: [
									{
										name: 'New invoice.pdf',
										url: 'https://source.example.test/new.pdf',
										sha256: 'b'.repeat(64)
									}
								]
							}
						: {})
				});
				const ui = yield* open(
					t,
					t.admin,
					`/app/operations/trade/orders?record=${collection}/${id}`,
					locale,
					{
						'operations/trade/orders': () =>
							import('../../src/app/operations/trade/+orders.page.svelte')
					},
					representations
				);
				const root = () =>
					ui.target.querySelector(`[data-view="record"][data-collection="${collection}"]`);
				try {
					yield* Effect.tryPromise({
						try: () =>
							vi.waitFor(() => {
								flushSync();
								expect((() => root()?.textContent?.includes('SOURCE-NEW') === true)()).toBe(true);
							}),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
					expect(root()?.querySelector('form')).toBeNull();
					expect(root()?.querySelector('[data-view-new]')).toBeNull();
					if (collection === 'transactions')
						expect(root()?.querySelector('a')?.getAttribute('href')).toBe(
							'https://source.example.test/new.pdf'
						);
					const history = ui.target.querySelector<HTMLButtonElement>('[data-timeline-trigger]');
					expect(history).not.toBeNull();
					history!.click();
					yield* Effect.tryPromise({
						try: () =>
							vi.waitFor(() => {
								flushSync();
								expect((() => document.querySelector('[role="slider"]') !== null)()).toBe(true);
							}),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
					document
						.querySelector('[role="slider"]')!
						.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
					yield* Effect.tryPromise({
						try: () =>
							vi.waitFor(() => {
								flushSync();
								expect((() => root()?.textContent?.includes('SOURCE-OLD') === true)()).toBe(true);
							}),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
					expect(root()?.textContent).not.toContain('SOURCE-NEW');
					if (collection === 'transactions')
						expect(root()?.querySelector('a')?.getAttribute('href')).toBe(
							'https://source.example.test/old.pdf'
						);
				} finally {
					yield* ui.close();
				}
			})
	);
}
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
