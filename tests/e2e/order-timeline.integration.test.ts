// @vitest-environment happy-dom
import { fixtureId, firstRow } from '../test-runtime.js';
import { vi, expect, it as test } from '@effect/vitest';
import { Schema, Effect } from 'effect';
import { sourceOrder } from '../synced-kit.js';
import { sourceFixture } from '../source-fixture.js';
import { flushSync } from 'svelte';
import type { Json } from '@norbital-ai/bolt/engine';
import type { ShellMountConfig } from '@norbital-ai/bolt/test/browser';
import { workspace, draft, confirm } from '../kit.js';
import { open } from './open.js';
import english from '../../src/i18n/+messages.js';
import chinese from '../../src/i18n/+zh.messages.js';
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
test.live.each(['en', 'zh'])(
	'%s: activity modal saves once and timeline shows creation, update and order finalization',
	(locale) =>
		Effect.gen(function* () {
			let salesFacts: Json[] = [];
			const t = yield* workspace({
				source: sourceFixture(() => ({ '/source_sales_lines': salesFacts }))
			});
			const actor = t.member(['manager'], {
				teams: ['Commercial Managers'],
				teamPath: ['Commercial Managers']
			});
			if (actor.actor.kind !== 'member') throw new Error('Member required');
			const { order, line } = yield* draft(t, 'sales', fixtureId('sys_user', actor.actor.id));
			yield* confirm(t, order);
			salesFacts = [
				{
					external_code: 'TIMELINE-SHIPMENT',
					order_id: order,
					order_line_id: line,
					kind: 'shipment',
					reference: 'Timeline shipment',
					business_on: '2026-10-10',
					source_updated_at: '2026-10-10T00:00:00Z',
					seal_hash: String((yield* t.as(t.admin).get('orders', order))?.seal_hash),
					unit: 'kg',
					quantity: '4',
					currency: 'SGD',
					net_amount: '8',
					tax_amount: '0.72',
					freight: '1'
				}
			];
			expect(yield* t.pull('source_sales_lines', 'timeline-source')).toMatchObject({
				pages: expect.any(Number)
			});
			const words = locale === 'zh' ? chinese : english;
			const ui = yield* open(
				t,
				actor,
				`/app/operations/trade/orders?record=orders/${order}`,
				locale,
				{
					'operations/trade/orders': () =>
						import('../../src/app/operations/trade/+orders.page.svelte')
				},
				representations
			);
			const root = () => ui.target.querySelector('[data-view="record"][data-collection="orders"]');
			const modal = () =>
				Array.from(document.querySelectorAll('[role="dialog"]')).find((element) =>
					(element.getAttribute('aria-labelledby') ?? '')
						.split(' ')
						.some(
							(id) =>
								document.getElementById(id)?.textContent?.trim() ===
								words['models.activities.singular']
						)
				);
			try {
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() => !!root()?.querySelector('[data-section=contract] [role=combobox]'))()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				yield* sourceOrder(t, order);
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => ui.target.textContent?.includes('CONFIRMED') === true)()).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(ui.target.querySelector('[data-order-confirmation]')?.textContent).toContain(
					words['component.confirmation_confirmed']
				);
				const contract = root()!.querySelector('[data-section="contract"]')!;
				expect(contract.firstElementChild?.querySelector('[role="combobox"]')).not.toBeNull();
				expect(contract.querySelector('[id$="-body"] [role="combobox"]')).toBeNull();
				expect(root()!.querySelector('[data-section="order"] h3')).toBeNull();
				expect(root()!.querySelector('[data-collection="ext_sales_orders"] table')).toBeNull();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									Array.from(root()?.querySelectorAll('[role="tab"]') ?? []).some(
										(button) => button.textContent?.trim() === words['models.activities.label']
									))()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				Array.from(root()!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
					.find((button) => button.textContent?.trim() === words['models.activities.label'])!
					.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => !!root()?.querySelector('[data-collection=activities]'))()).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(root()?.querySelector('[data-collection="activities"] form')).toBeNull();
				const add = root()!.querySelector<HTMLButtonElement>(
					'[data-collection="activities"] [data-view-new]'
				);
				expect(add).not.toBeNull();
				add!.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => !!modal()?.querySelector('[data-field="title"] input'))()).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(modal()?.querySelector('[data-field="order"]')).toBeNull();
				const title = modal()!.querySelector<HTMLInputElement>('[data-field="title"] input')!;
				title.value = 'Timeline modal fixture';
				title.dispatchEvent(new Event('input', { bubbles: true }));
				modal()!
					.querySelector<HTMLButtonElement>('[data-field="owner"] [role="combobox"]')!
					.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									!!document.querySelector(
										`[role="option"][data-value="${actor.actor.kind === 'member' ? actor.actor.id : ''}"] button`
									))()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				document
					.querySelector<HTMLButtonElement>(
						`[role="option"][data-value="${actor.actor.id}"] button`
					)!
					.click();
				modal()!
					.querySelector('form')!
					.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									!modal() && root()?.textContent?.includes('Timeline modal fixture') === true)()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(
					root()?.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()
				).toBe(words['models.activities.label']);
				const rows = yield* t
					.as(actor)
					.read('activities', { where: { order: { eq: order } }, all: true });
				expect(rows.rows).toHaveLength(1);
				expect(
					yield* t.as(actor).act('activities.update', {
						target: firstRow(rows.rows).id,
						set: { done: true, notes: 'Customer called' }
					})
				).toMatchObject({ kind: 'committed' });
				document.querySelector<HTMLButtonElement>('[data-timeline-trigger]')!.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									document
										.querySelector('[data-record-history-events]')
										?.textContent?.includes('Timeline shipment') === true)()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(document.querySelector('[data-record-history-events]')?.textContent).toContain(
					'Timeline modal fixture'
				);
				expect(document.querySelector('[data-record-history-events]')?.textContent).toContain(
					words['models.activities.fields.done']
				);
				expect(document.querySelector('[data-record-timeline] [role=slider]')).not.toBeNull();
				document.querySelector<HTMLButtonElement>('[data-timeline-trigger]')!.click();
				Array.from(root()!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
					.find((b) => b.textContent?.trim() === words['section.general'])!
					.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									!!Array.from(root()!.querySelectorAll('button')).find(
										(b) => b.textContent?.trim() === words['component.new_contract_version']
									))()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				Array.from(root()!.querySelectorAll<HTMLButtonElement>('button'))
					.find((b) => b.textContent?.trim() === words['component.new_contract_version'])!
					.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => !!root()?.querySelector('[data-field="title"] input'))()).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect((yield* t.as(actor).get('orders', order))?.status).toBe('draft');
			} finally {
				yield* ui.close();
			}
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
