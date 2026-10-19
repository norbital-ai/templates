import { Schema, Effect, Layer, ManagedRuntime } from 'effect';
import { mountEdge } from '@norbital-ai/ui/effect';
import { fixtureId } from '../test-runtime.js';
import { ActConflict, ActRefused, ActUnknown } from '@norbital-ai/bolt/errors';
// @vitest-environment happy-dom
import { expect, it } from '@effect/vitest';
import { vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { _api as icons } from '@iconify/svelte';
import type { Outcome } from '@norbital-ai/bolt';
import { visitId } from './ui-fixtures.js';
import Recovery from '../../src/lib/Recovery.svelte';
const api = vi.hoisted(() => ({
	act: vi.fn(),
	notify: vi.fn(),
	locale: 'en',
	t: (key: string) => key
}));
vi.mock('$bolt', async () => ({ ...(await import('@norbital-ai/ui/effect')), bolt: api }));
vi.mock('@norbital-ai/ui', async (original) => ({
	...(await original<typeof import('@norbital-ai/ui')>()),
	notifyOutcome: api.notify
}));
vi.mock('../../src/lib/live.svelte.js', async () => {
	const { recoveryFixture } = await import('./ui-fixtures.js');
	return {
		live: (() => {
			let n = 0;
			return () => {
				const index = n++ % 3;
				const fixture = recoveryFixture();
				return {
					current:
						index === 0
							? {
									rows: [fixture.visit]
								}
							: index === 1
								? fixture.candidates
								: []
				};
			};
		})()
	};
});
it.live.each([
	{ label: 'app.recovery.approve', action: 'visits.rebook' },
	{ label: 'app.recovery.refresh', action: 'visits.recommend' },
	{ label: 'app.recovery.prepare', action: 'visits.report_unavailable' }
])('restores $label after a held native rejection and permits retry', ({ label, action }) =>
	Effect.gen(function* () {
		const visit = visitId;
		api.act.mockReset();
		const pending = Promise.withResolvers<Outcome<unknown>>();
		api.act.mockImplementationOnce(() =>
			Effect.tryPromise({
				try: () => pending.promise,
				catch: (cause) =>
					new TestIoFailed({ message: String(cause instanceof Error ? cause.message : cause) })
			}).pipe(Effect.flatMap(outcomeEffect))
		);
		api.act.mockReturnValue(
			outcomeEffect({ kind: 'refused', code: 'forbidden', message: 'Cannot retry' })
		);
		const previousFetch = icons.getFetch();
		icons.setFetch(async () => new Response('{}', { status: 404 }));
		const target = document.createElement('div');
		document.body.append(target);
		const disposeEdge = mountEdge(ManagedRuntime.make(Layer.empty));
		yield* Effect.addFinalizer(() =>
			Effect.tryPromise({
				try: disposeEdge,
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			}).pipe(Effect.orDie)
		);
		const app = mount(Recovery, { target, props: { visit } });
		try {
			flushSync();
			const button = [...target.querySelectorAll('button')].find((b) =>
				b.textContent?.includes(label)
			);
			if (!button) throw new Error(`Missing ${label}`);
			button.click();
			flushSync();
			expect(api.act).toHaveBeenCalledWith(action, expect.objectContaining({ target: visit }));
			expect(button.disabled).toBe(true);
			button.click();
			expect(api.act).toHaveBeenCalledOnce();
			pending.reject(new Error('Native connection lost'));
			yield* Effect.tryPromise({
				try: () => vi.waitFor(() => expect(button.disabled).toBe(false)),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(target.textContent).toContain('Native connection lost');
			button.click();
			yield* Effect.tryPromise({
				try: () => vi.waitFor(() => expect(target.textContent).toContain('Cannot retry')),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(api.act).toHaveBeenCalledTimes(2);
			expect(button.disabled).toBe(false);
		} finally {
			yield* Effect.tryPromise({
				try: () => unmount(app),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			target.remove();
			if (previousFetch) icons.setFetch(previousFetch);
		}
	})
);
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
const outcomes: Outcome<unknown>[] = [
	{ kind: 'committed', output: null, records: [] },
	{ kind: 'refused', code: 'forbidden', message: 'Cannot recover this visit' },
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
it.live.each([
	{ label: 'app.recovery.approve', action: 'visits.rebook', saved: 'app.recovery.approved' },
	{ label: 'app.recovery.refresh', action: 'visits.recommend', saved: null },
	{
		label: 'app.recovery.prepare',
		action: 'visits.report_unavailable',
		saved: 'app.recovery.prepared'
	}
])('reports $label as complete only after its native write commits', ({ label, action, saved }) =>
	Effect.gen(function* () {
		const visit = visitId;
		const previousFetch = icons.getFetch();
		icons.setFetch(async () => new Response('{}', { status: 404 }));
		try {
			for (const outcome of outcomes) {
				api.act.mockReset();
				api.notify.mockReset();
				const pending = Promise.withResolvers<Outcome<unknown>>();
				api.act.mockImplementationOnce(() =>
					Effect.tryPromise({
						try: () => pending.promise,
						catch: (cause) =>
							new TestIoFailed({ message: String(cause instanceof Error ? cause.message : cause) })
					}).pipe(Effect.flatMap(outcomeEffect))
				);
				const target = document.createElement('div');
				document.body.append(target);
				const disposeEdge = mountEdge(ManagedRuntime.make(Layer.empty));
				yield* Effect.addFinalizer(() =>
					Effect.tryPromise({
						try: disposeEdge,
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					}).pipe(Effect.orDie)
				);
				const app = mount(Recovery, { target, props: { visit } });
				try {
					flushSync();
					const button = [...target.querySelectorAll('button')].find((b) =>
						b.textContent?.includes(label)
					);
					if (!button) throw new Error(`Missing ${label}`);
					button.click();
					flushSync();
					expect(api.act).toHaveBeenCalledWith(action, expect.objectContaining({ target: visit }));
					expect(button.disabled).toBe(true);
					pending.resolve(outcome);
					yield* Effect.tryPromise({
						try: () =>
							vi.waitFor(() => {
								if (outcome.kind === 'committed' && saved !== null)
									expect(target.textContent).toContain(saved);
								else if (outcome.kind === 'refused')
									expect(target.textContent).toContain(outcome.message);
								else if (outcome.kind !== 'committed')
									expect(api.notify).toHaveBeenCalledWith(api, outcome);
								else expect(button.disabled).toBe(false);
							}),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
					if (outcome.kind !== 'committed') {
						expect(target.textContent).not.toContain('app.recovery.approved');
						expect(target.textContent).not.toContain('app.recovery.prepared');
						expect(button.disabled).toBe(false);
						expect(target.contains(button)).toBe(true);
					}
					if (outcome.kind === 'committed' || outcome.kind === 'refused')
						expect(api.notify).not.toHaveBeenCalled();
				} finally {
					yield* Effect.tryPromise({
						try: () => unmount(app),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
					target.remove();
				}
			}
		} finally {
			if (previousFetch) icons.setFetch(previousFetch);
		}
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
