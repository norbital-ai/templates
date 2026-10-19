// @vitest-environment happy-dom
import { firstRow } from '../test-runtime.js';
import { vi, expect, it as test } from '@effect/vitest';
import { Schema, Effect } from 'effect';
import { flushSync } from 'svelte';
import { workspace } from '../kit.js';
import { open } from './open.js';
import english from '../../src/i18n/+messages.js';
import chinese from '../../src/i18n/+zh.messages.js';
for (const role of ['manager', 'procurement'] as const) {
	test.live.each(['en', 'zh'])(`%s: ${role} inventory loads read-only lots`, (locale) =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const words = locale === 'zh' ? chinese : english;
			const team = role === 'manager' ? 'Commercial Managers' : 'Procurement';
			const ui = yield* open(
				t,
				t.member([role], { teams: [team], teamPath: [team] }),
				'/app/operations/warehouse/stock',
				locale,
				{
					'operations/warehouse/stock': () =>
						import('../../src/app/operations/warehouse/+stock.page.svelte')
				}
			);
			try {
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									Array.from(ui.target.querySelectorAll('[role="tab"]')).some(
										(tab) => tab.textContent?.trim() === words['models.stock_snapshots.label']
									))()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				Array.from(ui.target.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
					.find((tab) => tab.textContent?.trim() === words['models.stock_snapshots.label'])!
					.click();
				const query = 'stock_snapshots';
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									ui.traffic.some((entry) => entry.includes(query)) &&
									ui.target.querySelector('[data-view="table"] [data-read="empty"]') !== null)()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(ui.target.textContent).not.toContain('invalidInput');
				expect(ui.target.querySelector('[data-view-new]')).toBeNull();
				expect(ui.target.querySelector('form')).toBeNull();
			} finally {
				yield* ui.close();
			}
		})
	);
}
test.live.each(['en', 'zh'])('populated inventory shows lot quantity and cost in %s', (locale) =>
	Effect.gen(function* () {
		const products = (yield* Effect.tryPromise({
			try: () => import('../../seed/products.json', { with: { type: 'json' } }),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		})).default;
		const warehouses = (yield* Effect.tryPromise({
			try: () => import('../../seed/warehouses.json', { with: { type: 'json' } }),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		})).default;
		const settings = (yield* Effect.tryPromise({
			try: () => import('../../seed/commercial_settings.json', { with: { type: 'json' } }),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		})).default;
		const t = yield* workspace({
			seed: {
				products,
				warehouses,
				commercial_settings: settings,
				stock_snapshots: [
					{
						id: '00000000-0000-4000-8000-000000000501',
						external_code: 'RESIN-A:WEST:kg',
						source: 'kingdee',
						product: firstRow(products).id,
						warehouse: firstRow(warehouses).id,
						unit: 'kg',
						lot_number: 'LOT-001',
						currency: 'SGD',
						unit_cost: '1.50',
						on_hand: '100',
						erp_committed: '30',
						as_of: new Date().toISOString(),
						orders_as_of: new Date().toISOString()
					}
				]
			}
		});
		const words = locale === 'zh' ? chinese : english;
		const ui = yield* open(
			t,
			t.member(['manager'], {
				teams: ['Commercial Managers'],
				teamPath: ['Commercial Managers']
			}),
			'/app/operations/warehouse/stock',
			locale,
			{
				'operations/warehouse/stock': () =>
					import('../../src/app/operations/warehouse/+stock.page.svelte')
			}
		);
		try {
			for (let i = 0; i < 400 && !ui.target.querySelector('[role="tab"]'); i++) {
				yield* Effect.sleep('5 millis');
				flushSync();
			}
			Array.from(ui.target.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
				.find((tab) => tab.textContent?.trim() === words['models.stock_snapshots.label'])!
				.click();
			for (let i = 0; i < 400 && !ui.target.textContent?.includes('LOT-001'); i++) {
				yield* Effect.sleep('5 millis');
				flushSync();
			}
			expect(ui.target.textContent).toContain('LOT-001');
			expect(ui.target.textContent).toContain('100');
			expect(ui.target.textContent).not.toContain('stale_source');
			expect(ui.target.textContent).not.toContain(
				words['models.stock_snapshots.fields.reason.stale_source']
			);
			expect(ui.target.querySelector('[data-view-new]')).toBeNull();
		} finally {
			yield* ui.close();
		}
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
