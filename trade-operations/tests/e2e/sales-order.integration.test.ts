// @vitest-environment happy-dom
import { decimalText, firstRow } from '../test-runtime.js';
import { Context, Schema, Effect } from 'effect';
import { Approvals, Identity, BoltError } from '@norbital-ai/bolt/engine';
import { vi, expect, it as test } from '@effect/vitest';
import { flushSync } from 'svelte';
import type { ShellMountConfig } from '@norbital-ai/bolt/test/browser';
import {
	committed,
	confirm as seal,
	draft,
	CUSTOMER,
	SUPPLIER,
	PRODUCT,
	workspace
} from '../kit.js';
import { open } from './open.js';
import english from '../../src/i18n/+messages.js';
import chinese from '../../src/i18n/+zh.messages.js';
type Loader = NonNullable<ShellMountConfig['representations']>[string];
const loads = import.meta.glob<Awaited<ReturnType<Loader>>>(
	'../../src/data/collection/**/+representation.svelte'
);
const representations = Object.fromEntries(
	Object.entries(loads).map(([p, f]) => [
		p.replace('../../src/data/collection/', '').replace('/+representation.svelte', ''),
		f
	])
);
test.live.each([
	['en', 'sales', 'SGD', null, '21.80', '2.0000'],
	['zh', 'sales', 'SGD', null, '21.80', '2.0000'],
	['en', 'purchasing', 'SGD', '1.25', '13.63', '1.25'],
	['zh', 'purchasing', 'SGD', '1.25', '13.63', '1.25'],
	['en', 'sales', 'USD', '3', '32.70', '3'],
	['zh', 'sales', 'USD', '3', '32.70', '3']
] as const)(
	'%s %s %s: product defaults, line save and confirmation seal one order',
	([locale, direction, currency, manual, total, price]) =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const team = direction === 'sales' ? 'Sales' : 'Procurement';
			const sales = t.member([direction === 'sales' ? 'sales' : 'procurement'], {
				teams: [team],
				teamPath: [team]
			});
			const as = t.as(sales);
			const order = committed(
				'orders',
				yield* as.act('orders.create', {
					title: 'UI sales journey',
					direction,
					party: direction === 'sales' ? CUSTOMER : SUPPLIER,
					currency,
					payment_terms: 'Net 30'
				})
			);
			const words = locale === 'zh' ? chinese : english;
			const ui = yield* open(
				t,
				sales,
				`/app/operations/trade/orders?record=orders/${order}`,
				locale,
				{
					'operations/trade/orders': () =>
						import('../../src/app/operations/trade/+orders.page.svelte')
				},
				representations
			);
			const root = () => ui.target.querySelector('[data-view="record"][data-collection="orders"]');
			const line = () => Array.from(document.querySelectorAll('[role="dialog"]')).at(-1);
			const tab = (name: string) =>
				Array.from(root()?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []).find((b) =>
					b.textContent?.includes(name)
				);
			try {
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => !!tab(words['section.general']))()).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				tab(words['section.general'])!.click();
				const create = () =>
					root()?.querySelector<HTMLButtonElement>(
						'[data-collection="order_lines"] [data-view-new]'
					);
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => !!create())()).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(root()?.querySelector('[data-collection="order_lines"] form')).toBeNull();
				create()!.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() => !!line()?.querySelector('[data-field="product"] [role="combobox"]'))()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				line()!
					.querySelector<HTMLButtonElement>('[data-field="product"] [role="combobox"]')!
					.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									!!document.querySelector(`[role="option"][data-value="${PRODUCT}"] button`))()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				document
					.querySelector<HTMLButtonElement>(`[role="option"][data-value="${PRODUCT}"] button`)!
					.click();
				const input = (name: string) =>
					line()?.querySelector<HTMLInputElement>(`[data-field="${name}"] input`);
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									(manual
										? input('unit_price')?.value === ''
										: Number(input('unit_price')?.value) === 2) &&
									Number(input('tax_rate')?.value) === 9)()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				if (manual) {
					input('unit_price')!.value = manual;
					input('unit_price')!.dispatchEvent(new Event('input', { bubbles: true }));
				}
				input('quantity')!.value = '10';
				input('quantity')!.dispatchEvent(new Event('input', { bubbles: true }));
				line()!
					.querySelector<HTMLFormElement>('form')!
					.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => root()?.textContent?.includes(`${currency} ${total}`) === true)()).toBe(
								true
							);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				const rows = yield* as.read('order_lines', { where: { order: { eq: order } }, all: true });
				expect(rows.rows).toHaveLength(1);
				expect(rows.rows[0]).toMatchObject({
					total: decimalText(total),
					tax_rate: decimalText('9')
				});
				flushSync();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => !!root()?.querySelector<HTMLButtonElement>('[role="tab"]'))()).toBe(
								true
							);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				Array.from(root()!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))[0]!.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									Array.from(root()?.querySelectorAll<HTMLButtonElement>('button') ?? []).some(
										(b) => b.textContent?.includes(words['component.confirm_seal'])
									))()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(root()!.textContent).not.toContain(words['component.credit_acknowledge']);
				const confirm = Array.from(root()!.querySelectorAll<HTMLButtonElement>('button')).find(
					(b) => b.textContent?.includes(words['component.confirm_seal'])
				)!;
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => !confirm.disabled)()).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				confirm.click();
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect(
								(() =>
									ui.target.textContent?.includes(words['component.awaiting_approval']) === true)()
							).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				// The confirmation is applied at once; the request holds the sealed order until it is decided.
				expect(yield* as.get('orders', order)).toMatchObject({
					status: 'confirmed',
					seal_hash: expect.any(String)
				});
				const requests = yield* Context.get(t.services, Approvals).list(
					{ collection: 'orders', records: [order] },
					as.authority,
					(collection, id) =>
						collection === 'orders' && id === order
							? as.get('orders', order).pipe(
									Effect.map((row) => row !== null),
									Effect.mapError((failure) =>
										BoltError.make('upstream', 'facility', failure.message, failure)
									)
								)
							: Effect.succeed(false)
				);
				expect(requests).toHaveLength(1);
				expect(requests[0]).toMatchObject({ status: 'ONGOING', mine: true });
				const approver = t.member(['manager'], {
					teams: ['Commercial Managers'],
					teamPath: ['Commercial Managers']
				});
				const decision = yield* Context.get(t.services, Approvals).process({
					requestId: firstRow(requests).id,
					status: 'APPROVED',
					authority: yield* Context.get(t.services, Identity).authority(approver),
					now: t.clock.now()
				});
				expect(decision, JSON.stringify(decision)).toMatchObject({
					kind: 'decided',
					status: 'APPROVED'
				});
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => root()?.textContent?.includes('Net 30') === true)()).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(root()!.querySelector('[data-field="payment_terms"] input')).toBeNull();
				expect(root()!.textContent).toContain('Net 30');
				const expectedDate = new Intl.DateTimeFormat(locale, {
					dateStyle: 'medium',
					timeZone: 'UTC'
				}).format(new Date('2026-10-10T00:00:00Z'));
				expect(root()!.querySelector('[data-field="ordered_on"]')?.textContent).toContain(
					expectedDate
				);
				expect(yield* as.get('orders', order)).toMatchObject({
					status: 'confirmed',
					sealed_snapshot: { total, lines: [{ unit_price: price, tax_rate: '9' }] }
				});
				expect((yield* as.read('orders', { all: true })).rows).toHaveLength(1);
			} finally {
				yield* ui.close();
			}
		})
);
test.live('new version opens terms and items together in the draft contract', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const own = yield* draft(t);
		yield* seal(t, own.order);
		const ui = yield* open(
			t,
			t.admin,
			`/app/operations/trade/orders?record=orders/${own.order}`,
			'en',
			{
				'operations/trade/orders': () =>
					import('../../src/app/operations/trade/+orders.page.svelte')
			},
			representations
		);
		try {
			const action = () =>
				Array.from(ui.target.querySelectorAll<HTMLButtonElement>('button')).find(
					(b) => b.textContent?.trim() === english['component.new_contract_version']
				);
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => !!action())()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			action()!.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() =>
								!!ui.target.querySelector(
									'[data-section="contract"] [data-field="payment_terms"] input'
								))()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const section = ui.target.querySelector('[data-section="contract"]')!;
			expect(section.getAttribute('data-open')).toBe('true');
			expect(
				section.querySelector<HTMLInputElement>('[data-field="payment_terms"] input')?.value
			).toBe('Net 30');
			expect(section.querySelector('[data-collection="order_lines"]')).not.toBeNull();
			expect(section.querySelector('[role="combobox"]')).not.toBeNull();
			expect(ui.target.querySelector('[data-section="terms"]')).toBeNull();
			expect(ui.target.querySelector('[data-section="agreement"]')).toBeNull();
			expect(ui.target.querySelector('[data-field="title"] input')).not.toBeNull();
			section.querySelector<HTMLButtonElement>('[role="combobox"]')!.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() =>
								Array.from(document.querySelectorAll('button')).some(
									(button) => button.textContent?.trim() === 'Contract 001'
								))()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
				.find((button) => button.textContent?.trim() === 'Contract 001')!
				.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => ui.target.querySelector('[data-field="payment_terms"] input') === null)()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(ui.target.querySelector('[data-field="title"] input')).toBeNull();
			ui.target
				.querySelector<HTMLButtonElement>('[data-section="contract"] [role="combobox"]')
				?.click();
			const draftVersion = () =>
				Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
					(button) => button.textContent?.trim() === 'Draft · 002'
				);
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => draftVersion() !== undefined)()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			draftVersion()?.click();
			const confirm = () =>
				Array.from(ui.target.querySelectorAll<HTMLButtonElement>('button')).find(
					(button) => button.textContent?.trim() === english['component.confirm_seal']
				);
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => confirm() !== undefined && confirm()?.disabled === false)()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			confirm()?.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => ui.target.textContent?.includes(english['component.seal_saved']) === true)()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(yield* t.as(t.admin).get('orders', own.order)).toMatchObject({
				status: 'confirmed',
				contract_version: 2
			});
			expect(
				Array.from(ui.target.querySelectorAll<HTMLButtonElement>('button')).some(
					(button) => button.textContent?.trim() === 'Cancel'
				)
			).toBe(false);
		} finally {
			yield* ui.close();
		}
	})
);
test.live('failed amendment releases the button and retry creates only one draft', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const own = yield* draft(t);
		yield* seal(t, own.order);
		let failNext = true;
		const ui = yield* open(
			t,
			t.admin,
			`/app/operations/trade/orders?record=orders/${own.order}`,
			'en',
			{
				'operations/trade/orders': () =>
					import('../../src/app/operations/trade/+orders.page.svelte')
			},
			representations,
			(request) => {
				if (failNext && request.url.endsWith('/act') && request.method === 'POST') {
					failNext = false;
					throw new Error('Connection lost before delivery');
				}
			}
		);
		const action = () =>
			Array.from(ui.target.querySelectorAll<HTMLButtonElement>('button')).find(
				(button) => button.textContent?.trim() === english['component.new_contract_version']
			);
		try {
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(() => {
							flushSync();
							return action()?.disabled;
						})
						.toBe(false),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			action()?.click();
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(() => {
							flushSync();
							return ui.target.textContent;
						})
						.toContain(english['component.seal_uncertain']),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(action()?.disabled).toBe(false);
			expect(yield* t.as(t.admin).get('orders', own.order)).toMatchObject({
				status: 'confirmed',
				contract_version: 1
			});
			action()?.click();
			yield* Effect.tryPromise({
				try: () =>
					expect
						.poll(() =>
							Effect.runPromise(
								t
									.as(t.admin)
									.get('orders', own.order)
									.pipe(Effect.map((row) => row?.status))
							)
						)
						.toBe('draft'),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(yield* t.as(t.admin).get('orders', own.order)).toMatchObject({
				contract_version: 1,
				contract_versions: [{ version: 1 }]
			});
			expect((yield* t.as(t.admin).read('orders', { all: true })).rows).toHaveLength(1);
		} finally {
			yield* ui.close();
		}
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
