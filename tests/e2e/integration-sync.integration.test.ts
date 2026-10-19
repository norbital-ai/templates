import { FacilityFailure } from '@norbital-ai/bolt/errors';
// @vitest-environment happy-dom
import { vi, expect, it as test } from '@effect/vitest';
import { Schema, Effect } from 'effect';
import { flushSync } from 'svelte';
import type { ShellMountConfig } from '@norbital-ai/bolt/test/browser';
import { workspace, draft, confirm } from '../kit.js';
import { sourceOrder } from '../synced-kit.js';
import { open } from './open.js';
import english from '../../src/i18n/+messages.js';
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
test.live('live confirmation recovers from a sync error without changing the sealed order', () =>
	Effect.gen(function* () {
		let fail = true;
		const t = yield* workspace({
			source: (request) =>
				Effect.try({
					try: () => {
						if (fail) throw new Error('Simulated accounting connection interruption');
						return { rows: [{ remote: 'SO-LIVE-1', hash: request.parameters.hash ?? '' }] };
					},
					catch: (cause) => new FacilityFailure({ kind: 'upstream', message: String(cause) })
				})
		});
		const { order } = yield* draft(t);
		yield* confirm(t, order);
		const as = t.as(t.admin);
		const initial = yield* as.get('orders', order);
		if (initial === null) throw new Error('Sealed order required');
		const history = () =>
			t.db.read([
				{
					text: 'SELECT revision, op FROM bolt_history WHERE collection = $1 AND record = $2::uuid ORDER BY revision',
					params: ['orders', order]
				}
			]);
		const initialHistory = yield* history();
		const ui = yield* open(
			t,
			t.admin,
			`/app/operations/trade/orders?record=orders/${order}`,
			'en',
			{
				'operations/trade/orders': () =>
					import('../../src/app/operations/trade/+orders.page.svelte')
			},
			representations
		);
		const confirmation = () =>
			ui.target.querySelector('[data-order-confirmation]')?.textContent ?? '';
		try {
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => confirmation().includes(english['component.confirmation_pending']))()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(yield* t.deliver()).toMatchObject({ sent: 0 });
			expect((yield* as.get('orders', order))?.$outbound?.['kingdee.orders']).toMatchObject({
				status: 'queued'
			});
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => confirmation().includes(english['component.confirmation_pending']))()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			fail = false;
			t.clock.advance('1min');
			expect(yield* t.deliver()).toMatchObject({
				sent: 1,
				failed: 0
			});
			expect((yield* as.get('orders', order))?.$outbound?.['kingdee.orders']).toMatchObject({
				status: 'sent'
			});
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() =>
								confirmation().includes(english['component.confirmation_pending']) &&
								!confirmation().includes(english['component.confirmation_error']))()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(yield* as.get('orders', order)).toMatchObject({
				revision: initial.revision,
				seal_hash: initial.seal_hash,
				status: 'confirmed'
			});
			expect(yield* history()).toEqual(initialHistory);
			yield* sourceOrder(t, order);
			yield* Effect.tryPromise({
				try: () =>
					vi.waitFor(() => {
						flushSync();
						expect(
							(() => confirmation().includes(english['component.confirmation_confirmed']))()
						).toBe(true);
					}),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(yield* as.get('orders', order)).toMatchObject({ revision: initial.revision });
			expect(yield* history()).toEqual(initialHistory);
		} finally {
			yield* ui.close();
		}
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
