import { Schema, Effect, Layer, ManagedRuntime } from 'effect';
import { mountEdge } from '@norbital-ai/ui/effect';
import { ActConflict, ActRefused, ActUnknown } from '@norbital-ai/bolt/errors';
// @vitest-environment happy-dom
import { expect, it } from '@effect/vitest';
import { vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { _api as icons } from '@iconify/svelte';
import type { Outcome as BoltOutcome } from '@norbital-ai/bolt';
import { fixtureId } from '../test-runtime.js';
type Outcome = BoltOutcome<unknown>;
import Today from '../../src/app/helper/+today.page.svelte';
import { employeeLocation } from '../../src/lib/employee-location.svelte.js';
const api = await vi.hoisted(async () => {
	const { fixtureId } = await import('../test-runtime.js');
	return {
		act: vi.fn(),
		notify: vi.fn(),
		read: vi.fn(),
		actor: { kind: 'member', id: fixtureId('sys_user', '0d500006-0000-4000-8000-000000000001') },
		locale: 'en',
		t: (key: string) => key
	};
});
vi.mock('$bolt', async () => ({ ...(await import('@norbital-ai/ui/effect')), bolt: api }));
vi.mock('@norbital-ai/ui', async (original) => ({
	...(await original<typeof import('@norbital-ai/ui')>()),
	notifyOutcome: api.notify
}));
vi.mock('../../src/lib/live.svelte.js', async () => {
	const { todayFixture } = await import('./ui-fixtures.js');
	return {
		live: (() => {
			let n = 0;
			return () => {
				const index = n++ % 4;
				const fixture = todayFixture();
				return {
					current: {
						rows: index === 0 ? [fixture.helper] : index === 1 ? [fixture.visit] : []
					}
				};
			};
		})()
	};
});
function outcomeEffect(
	outcome: import('@norbital-ai/bolt').Outcome<unknown>
): Effect.Effect<
	import('@norbital-ai/bolt').Committed<unknown> | import('@norbital-ai/bolt').PendingApproval,
	import('@norbital-ai/bolt/errors').ActFailure
> {
	switch (outcome.kind) {
		case 'refused':
			return Effect.fail(new ActRefused({ code: outcome.code, message: outcome.message }));
		case 'conflict':
			return Effect.fail(new ActConflict({ records: outcome.records }));
		case 'unknown':
			return Effect.fail(new ActUnknown({ invocation: outcome.invocation }));
		default:
			return Effect.succeed(outcome);
	}
}
const outcomes: Outcome[] = [
	{ kind: 'committed', output: null, records: [] },
	{ kind: 'refused', code: 'forbidden', message: 'Cannot start' },
	{ kind: 'conflict', records: [] },
	{
		kind: 'pendingApproval',
		requestId: 'approval',
		records: [
			{
				collection: 'visits',
				id: fixtureId('visits', '0d500009-0000-4000-8000-000000000001'),
				revision: 1
			}
		]
	},
	{ kind: 'unknown', invocation: 'invocation' }
];
it.live.each(outcomes)('restores controls and presents $kind after the pending action', (outcome) =>
	Effect.gen(function* () {
		api.act.mockClear();
		api.notify.mockClear();
		const iconFetch = icons.getFetch();
		icons.setFetch(async () => new Response('{}', { status: 404 }));
		const target = document.createElement('div');
		document.body.append(target);
		employeeLocation.here = { lat: 1.3, lng: 103.8 };
		const pending = Promise.withResolvers<Outcome>();
		api.act.mockImplementation(() =>
			Effect.tryPromise({
				try: () => pending.promise,
				catch: (cause) =>
					new TestIoFailed({ message: String(cause instanceof Error ? cause.message : cause) })
			}).pipe(Effect.flatMap(outcomeEffect))
		);
		const disposeEdge = mountEdge(ManagedRuntime.make(Layer.empty));
		yield* Effect.addFinalizer(() =>
			Effect.tryPromise({
				try: disposeEdge,
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			}).pipe(Effect.orDie)
		);
		const app = mount(Today, { target });
		try {
			flushSync();
			const button = [...target.querySelectorAll('button')].find((b) =>
				b.textContent?.includes('app.helper.start')
			);
			if (!button) throw new Error('Missing start control');
			button.click();
			flushSync();
			expect(api.act).toHaveBeenCalledOnce();
			expect(button.disabled).toBe(true);
			button.click();
			expect(api.act).toHaveBeenCalledOnce();
			pending.resolve(outcome);
			yield* Effect.tryPromise({
				try: () => vi.waitFor(() => expect(button.disabled).toBe(false)),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			if (outcome.kind === 'refused') expect(target.textContent).toContain(outcome.message);
			if (outcome.kind === 'committed' || outcome.kind === 'refused')
				expect(api.notify).not.toHaveBeenCalled();
			else expect(api.notify).toHaveBeenCalledWith(api, outcome);
		} finally {
			yield* Effect.tryPromise({
				try: () => unmount(app),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			employeeLocation.here = null;
			target.remove();
			if (iconFetch) icons.setFetch(iconFetch);
		}
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
