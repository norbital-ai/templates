// @vitest-environment happy-dom
import { fixtureId, firstRow } from '../test-runtime.js';
import { Schema, Effect } from 'effect';
import { sourceFixture } from '../source-fixture.js';
import { sourceOrder, sourceTransaction, sourcePayment } from '../synced-kit.js';
import type { Json } from '@norbital-ai/bolt/engine';
import { flushSync } from 'svelte';
import { expect, it as test, vi } from '@effect/vitest';
import { confirm, draft, workspace } from '../kit.js';
import { open } from './open.js';
import english from '../../src/i18n/+messages.js';
import chinese from '../../src/i18n/+zh.messages.js';
test.live.each(['en', 'zh'])('report tabs render scoped money and CSV exports in %s', (locale) =>
	Effect.gen(function* () {
		let sourceFacts: Json[] = [];
		const t = yield* workspace({
			source: sourceFixture(() => ({ '/source_sales_lines': sourceFacts }))
		});
		const sales = t.member(['sales'], { teams: ['Sales'], teamPath: ['Sales'] });
		const other = t.member(['sales'], { teams: ['Sales'], teamPath: ['Sales'] });
		const a = yield* draft(t, 'sales', fixtureId('sys_user', sales.id), '2026-09-01');
		const b = yield* draft(t, 'sales', fixtureId('sys_user', other.id), '2026-09-01');
		yield* confirm(t, a.order);
		yield* confirm(t, b.order);
		const as = t.as(t.admin);
		for (const order of [a, b]) {
			const parent = yield* sourceOrder(t, order.order);
			if (order === a) yield* sourcePayment(t, parent, null, '3');
			yield* sourceTransaction(t, order, parent, 'invoice', '2', {
				total: '4.36',
				issued_on: '2026-09-01',
				due_on: '2026-09-02'
			});
		}
		for (const [index, order] of [a, b].entries()) {
			const sealed = yield* as.get('orders', order.order);
			sourceFacts.push({
				external_code: `ERP-${index}`,
				order_id: order.order,
				order_line_id: order.line,
				kind: 'shipment',
				reference: `ERP-${index}`,
				business_on: '2026-10-02',
				source_updated_at: '2026-10-10T00:00:00Z',
				seal_hash: String(sealed?.seal_hash),
				unit: 'kg',
				quantity: '10',
				currency: 'SGD',
				net_amount: index === 0 ? '20' : '999',
				tax_amount: '1.80',
				freight: '3'
			});
		}
		sourceFacts = [
			...sourceFacts,
			{
				external_code: 'ERP-return',
				order_id: a.order,
				order_line_id: a.line,
				kind: 'return',
				reference: 'ERP-return',
				business_on: '2026-10-03',
				source_updated_at: '2026-10-10T00:00:00Z',
				seal_hash: String((yield* as.get('orders', a.order))?.seal_hash),
				unit: 'kg',
				quantity: '-2',
				currency: 'SGD',
				net_amount: '-4',
				tax_amount: '-0.36',
				freight: '-0.60'
			}
		];
		expect(yield* t.pull('source_sales_lines', 'report-ui-source')).toMatchObject({
			pages: expect.any(Number)
		});
		const ownNumber = String((yield* as.get('orders', a.order))?.number);
		const otherNumber = String((yield* as.get('orders', b.order))?.number);
		const words = locale === 'zh' ? chinese : english;
		t.clock.set(new Date().toISOString());
		const ui = yield* open(t, sales, '/app/operations/analysis/reports', locale, {
			'operations/analysis/reports': () =>
				import('../../src/app/operations/analysis/+reports.page.svelte')
		});
		const blobs: Blob[] = [];
		const objectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			if (!(blob instanceof Blob)) throw new Error('CSV export did not produce a blob');
			blobs.push(blob);
			return 'blob:report';
		});
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		yield* Effect.gen(function* () {
			const tab = (caption: string) =>
				Array.from(ui.target.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((button) =>
					button.textContent?.includes(caption)
				);
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => !!tab(words['component.ar_aging']))(),
							(() => `${ui.target.textContent}\n${ui.traffic.join('\n')}`)()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => ui.target.textContent?.includes('ERP-return') === true)()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(ui.target.textContent).toContain('ERP-0');
			expect(ui.target.querySelector('[data-table-list]')).toBeNull();
			expect(
				ui.target.querySelector('[data-view-toolbar] #sales-range') ??
					ui.target.querySelector('#sales-range')
			).not.toBeNull();
			expect(ui.target.textContent).not.toContain('ERP-1');
			expect(ui.target.textContent).toContain(ownNumber);
			expect(tab(words['reports.sales.summary'])).toBeUndefined();
			expect(ui.target.textContent).not.toContain('SGD 999');
			expect(ui.target.textContent).toContain(words['reports.freight.deduct']);
			ui.target.querySelector<HTMLButtonElement>('[data-view-actions]')!.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => document.querySelector('[data-menu-item="export"] button') !== null)()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			document.querySelector<HTMLButtonElement>('[data-menu-item="export"] button')!.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => blobs.length === 1)()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const salesCsv = yield* Effect.tryPromise({
				try: () => firstRow(blobs).text(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(salesCsv).toContain(words['reports.sales.net']);
			expect(salesCsv).toContain(words['reports.sales.freight']);
			expect(salesCsv).toContain(words['reports.freight.deduct']);
			expect(salesCsv).toContain('17.00');
			expect(salesCsv).not.toMatch(/(?:^|,)999(?:\.00)?(?:,|$)/m);
			tab(words['component.ar_aging'])!.click();
			flushSync();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() =>
								ui.target.textContent?.includes(ownNumber) === true &&
								ui.target.textContent?.includes('4.36') === true &&
								ui.target.querySelector('#ar-aging-date') !== null)(),
							(() => `${ui.target.textContent}\n${ui.traffic.join('\n')}`)()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(ui.target.textContent).not.toContain(otherNumber);
			const month = new Date().toISOString().slice(0, 7);
			const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
				.toISOString()
				.slice(0, 10);
			expect(
				ui.traffic.some(
					(entry) =>
						entry.includes('\"from\":\"' + month + '-01\"') &&
						entry.includes('\"to\":\"' + end + '\"')
				)
			).toBe(true);
			expect(ui.target.textContent).toContain('4.36');
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() =>
								ui.target.textContent?.includes(words['component.unallocated_credit']) === true)()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(ui.target.querySelectorAll('tbody tr')).toHaveLength(2);
			ui.target
				.querySelector<HTMLButtonElement>(
					`[aria-label="${locale === 'zh' ? '打开日历' : 'Open calendar'}"]`
				)!
				.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => document.querySelector('[data-value="2026-10-01"][role="button"]') !== null)()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			document
				.querySelector<HTMLButtonElement>('[data-value="2026-10-01"][role="button"]')!
				.click();
			flushSync();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => {
								const headers = Array.from(ui.target.querySelectorAll('thead th'));
								const index = headers.findIndex((cell) =>
									cell.textContent?.includes(words['reports.aging.1_30'])
								);
								const cells = ui.target.querySelector('tbody tr')?.querySelectorAll('td');
								return (
									index >= 0 &&
									cells?.[index]?.textContent?.includes('4.36') === true &&
									ui.target.querySelector('[data-view-actions]') !== null
								);
							})()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			ui.target.querySelector<HTMLButtonElement>('[data-view-actions]')!.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => document.querySelector('[data-menu-item="export"] button') !== null)()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			document.querySelector<HTMLButtonElement>('[data-menu-item="export"] button')!.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => blobs.length === 2)()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const csv = yield* Effect.tryPromise({
				try: () => firstRow(blobs.slice(1)).text(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(csv).toContain(words['models.source_payments.fields.invoice']);
			expect(csv).not.toContain(words['models.orders.fields.as_of']);
			expect(csv).toContain(words['reports.aging.1_30']);
			expect(csv).toContain(ownNumber);
			expect(csv).toContain('4.36');
			expect(csv).not.toContain(otherNumber);
			expect(csv).not.toContain(a.order);
			tab(words['component.commission'])!.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => ui.target.querySelector('#commission-month') !== null)()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(tab(words['component.monthly_commission_items'])).toBeUndefined();
			expect(ui.target.textContent).not.toContain(otherNumber);
		}).pipe(
			Effect.ensuring(
				Effect.gen(function* () {
					yield* Effect.sync(() => {
						objectURL.mockRestore();
						revoke.mockRestore();
						anchor.mockRestore();
					});
					yield* ui.close();
				})
			)
		);
	})
);
test.live('report defaults use the workspace calendar month at a UTC boundary', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T16:30:00Z'));
		const ui = yield* open(t, t.admin, '/app/operations/analysis/reports', 'en', {
			'operations/analysis/reports': () =>
				import('../../src/app/operations/analysis/+reports.page.svelte')
		});
		yield* Effect.gen(function* () {
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => ui.traffic.some((entry) => entry.includes('2026-10-31')))()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(ui.traffic.join('\n')).toContain('2026-10-01');
		}).pipe(
			Effect.ensuring(
				Effect.gen(function* () {
					yield* Effect.sync(() => now.mockRestore());
					yield* ui.close();
				})
			)
		);
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
