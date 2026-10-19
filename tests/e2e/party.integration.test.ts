// @vitest-environment happy-dom
import { fixtureId } from '../test-runtime.js';
import { vi, expect, it as test } from '@effect/vitest';
import { Schema, Effect } from 'effect';
import { flushSync } from 'svelte';
import type { ShellMountConfig } from '@norbital-ai/bolt/test/browser';
type Loader = NonNullable<ShellMountConfig['representations']>[string];
const representations = import.meta.glob<Awaited<ReturnType<Loader>>>(
	'../../src/data/collection/parties/+representation.svelte'
);
import { committed, draft, CUSTOMER, SUPPLIER, workspace } from '../kit.js';
import { open } from './open.js';
import english from '../../src/i18n/+messages.js';
import chinese from '../../src/i18n/+zh.messages.js';
test.live.each(['en', 'zh'])('party tabs scope contacts and visible SO history in %s', (locale) =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const sales = t.member(['sales'], { teams: ['Sales'], teamPath: ['Sales'] });
		const other = t.member(['sales'], { teams: ['Sales'], teamPath: ['Sales'] });
		const as = t.as(t.admin);
		const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.id));
		const foreign = yield* draft(t, 'sales', fixtureId('sys_user', other.id));
		const ownNumber = String((yield* as.get('orders', own.order))?.number);
		const foreignNumber = String((yield* as.get('orders', foreign.order))?.number);
		committed(
			'contacts',
			yield* as.act('contacts.create', { party: CUSTOMER, name: 'Customer contact' })
		);
		committed(
			'contacts',
			yield* as.act('contacts.create', { party: SUPPLIER, name: 'Supplier private contact' })
		);
		const words = locale === 'zh' ? chinese : english;
		const representation =
			representations['../../src/data/collection/parties/+representation.svelte'];
		if (representation === undefined) throw new Error('Party representation required');
		const ui = yield* open(
			t,
			sales,
			`/app/operations/partners/parties?record=parties/${CUSTOMER}`,
			locale,
			{
				'operations/partners/parties': () =>
					import('../../src/app/operations/partners/+parties.page.svelte')
			},
			{ parties: representation }
		);
		const text = () => `${ui.target.textContent}\n${ui.traffic.join('\n')}`;
		const record = () => ui.target.querySelector('[data-view="record"][data-collection="parties"]');
		const tab = (label: string) =>
			Array.from(record()?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []).find((b) =>
				b.textContent?.includes(label)
			);
		try {
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => !!tab(words['component.poc']))(), text()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			tab(words['component.poc'])!.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => record()?.textContent?.includes('Customer contact') === true)(),
							text()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(record()?.textContent).not.toContain('Supplier private contact');
			expect(record()?.querySelector('[data-collection="contacts"] form')).toBeNull();
			expect(
				record()?.querySelector('[data-collection="contacts"] [data-view-new]')
			).not.toBeNull();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => !!tab(words['component.orders']))(), text()).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			tab(words['component.orders'])!.click();
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect((() => record()?.textContent?.includes(ownNumber) === true)(), text()).toBe(
							true
						);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(record()?.textContent).not.toContain(foreignNumber);
		} finally {
			yield* ui.close();
		}
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
