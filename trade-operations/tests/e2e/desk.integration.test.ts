// @vitest-environment happy-dom
import { fixtureId } from '../test-runtime.js';
import { vi, expect, it as test } from '@effect/vitest';
import { Schema, Effect } from 'effect';
import { flushSync } from 'svelte';
import { draft, workspace } from '../kit.js';
import { open } from './open.js';
import english from '../../src/i18n/+messages.js';
import chinese from '../../src/i18n/+zh.messages.js';
test.live.each(['en', 'zh'])(
	'single operations table preserves pending SO ownership in %s',
	(locale) =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const sales = t.member(['sales'], { teams: ['Sales'], teamPath: ['Sales'] });
			const foreign = t.member(['sales'], { teams: ['Sales'], teamPath: ['Sales'] });
			const own = yield* draft(t, 'sales', fixtureId('sys_user', sales.id));
			const other = yield* draft(t, 'sales', fixtureId('sys_user', foreign.id));
			for (const [actor, order] of [
				[sales, own.order],
				[foreign, other.order]
			] as const) {
				const as = t.as(actor);
				const check = yield* as.query('orders.confirmation_check', { order });
				expect(
					yield* as.act('orders.update', {
						target: order,
						set: { status: 'confirmed', check_hash: check.check_hash }
					})
				).toMatchObject({ kind: 'pendingApproval' });
			}
			const ownNumber = String((yield* t.as(t.admin).get('orders', own.order))?.number);
			const foreignNumber = String((yield* t.as(t.admin).get('orders', other.order))?.number);
			const words = locale === 'zh' ? chinese : english;
			const ui = yield* open(t, sales, '/app/operations/trade/orders', locale, {
				'operations/trade/orders': () =>
					import('../../src/app/operations/trade/+orders.page.svelte')
			});
			try {
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => {
							flushSync();
							expect((() => ui.target.textContent?.includes(ownNumber) === true)()).toBe(true);
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(ui.target.textContent).not.toContain(foreignNumber);
			} finally {
				yield* ui.close();
			}
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
