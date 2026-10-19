// @vitest-environment happy-dom
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { Deferred, Effect, Layer, ManagedRuntime, Schema, Stream } from 'effect';
import { expect, it } from '@effect/vitest';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer } from 'vite';
import { vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { mountEdge } from '@norbital-ai/ui/effect';
import type { Read } from '@norbital-ai/bolt/page';
import type { ReadFailed } from '@norbital-ai/bolt/errors';
import PortalLive from './portal-live-harness.svelte';
import bookData from '../../src/app/portal/book.page.data.js';
import visitsData from '../../src/app/portal/visits.page.data.js';

const api = vi.hoisted(() => ({
	live: vi.fn<(read: Read<string | null>) => Stream.Stream<string | null, ReadFailed>>()
}));
vi.mock('$bolt', async () => ({ ...(await import('@norbital-ai/ui/effect')), bolt: api }));

class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
const io = <A>(work: () => Promise<A>) =>
	Effect.tryPromise({
		try: work,
		catch: (cause) => new TestIoFailed({ message: String(cause) })
	});
const query: Read<string | null> = Object.assign(Effect.succeed(null), {
	read: { m: 'read' as const, a: ['services', { all: true }] }
});

it.live('renders server answers without evaluating a browser read or starting its UI edge', () =>
	Effect.gen(function* () {
		const client = createRequire(import.meta.url).resolve('@norbital-ai/bolt/page');
		const server = yield* Effect.acquireRelease(
			io(() =>
				createServer({
					configFile: false,
					logLevel: 'silent',
					plugins: [svelte({ configFile: false })],
					resolve: {
						conditions: ['svelte', 'module', 'node'],
						alias: { $bolt: resolve(dirname(client), '../shell/public/server.js') }
					},
					ssr: { noExternal: true, resolve: { conditions: ['svelte', 'module', 'node'] } },
					server: { middlewareMode: true, watch: null, hmr: false },
					optimizeDeps: { noDiscovery: true, include: [] }
				})
			),
			(server) => io(() => server.close()).pipe(Effect.orDie)
		);
		const rendered = yield* io(() => server.ssrLoadModule('/tests/e2e/portal-ssr.ts')).pipe(
			Effect.flatMap(
				Schema.decodeUnknownEffect(Schema.Struct({ body: Schema.String, fibers: Schema.Int }))
			)
		);
		const target = document.createElement('div');
		target.innerHTML = rendered.body;
		expect(target.querySelector('[data-current]')?.textContent).toBe('Server answer');
		expect(target.querySelector('[data-error]')?.textContent).toBe('');
		expect(rendered.fibers).toBe(0);
	}).pipe(Effect.scoped)
);

it.live.each(['Current answer', null] as const)(
	'keeps server data through startup, accepts %s as the first answer, and never restores stale data',
	(answer) =>
		Effect.gen(function* () {
			api.live.mockReset();
			const first = yield* Deferred.make<string | null>();
			api.live.mockReturnValue(Stream.fromEffect(Deferred.await(first)));
			const dispose = mountEdge(ManagedRuntime.make(Layer.empty));
			yield* Effect.addFinalizer(() => io(dispose).pipe(Effect.orDie));
			const target = document.createElement('div');
			document.body.append(target);
			const app = mount(PortalLive, { target, props: { query, initial: 'Server answer' } });
			yield* Effect.addFinalizer(() =>
				io(() => unmount(app)).pipe(
					Effect.ensuring(Effect.sync(() => target.remove())),
					Effect.orDie
				)
			);
			flushSync();
			expect(target.querySelector('[data-current]')?.textContent).toBe('Server answer');
			yield* io(() => vi.waitFor(() => expect(api.live).toHaveBeenCalledOnce()));
			flushSync();
			expect(target.querySelector('[data-current]')?.textContent).toBe('Server answer');
			yield* Deferred.succeed(first, answer);
			yield* io(() =>
				vi.waitFor(() => {
					flushSync();
					expect(target.querySelector('[data-current]')?.textContent).toBe(answer ?? 'loading');
				})
			);
			target.querySelector('button')?.click();
			flushSync();
			expect(target.querySelector('[data-current]')?.textContent).toBe('loading');
		})
);

it.live('discards a server answer when its query changes before the first live result', () =>
	Effect.gen(function* () {
		api.live.mockReset();
		api.live.mockReturnValue(Stream.fromEffect(Effect.never));
		const dispose = mountEdge(ManagedRuntime.make(Layer.empty));
		yield* Effect.addFinalizer(() => io(dispose).pipe(Effect.orDie));
		const target = document.createElement('div');
		document.body.append(target);
		const app = mount(PortalLive, { target, props: { query, initial: 'Server answer' } });
		yield* Effect.addFinalizer(() =>
			io(() => unmount(app)).pipe(Effect.ensuring(Effect.sync(() => target.remove())), Effect.orDie)
		);
		flushSync();
		expect(target.querySelector('[data-current]')?.textContent).toBe('Server answer');
		target.querySelector('button')?.click();
		flushSync();
		expect(target.querySelector('[data-current]')?.textContent).toBe('loading');
	})
);

it('decodes the public visitor payloads and validates member data at the hydration boundary', () => {
	expect(Schema.decodeUnknownSync(bookData)({ mine: null, services: null, helpers: null })).toEqual(
		{ mine: null, services: null, helpers: null }
	);
	expect(Schema.decodeUnknownSync(visitsData)({ visits: null, notices: null })).toEqual({
		visits: null,
		notices: null
	});
	expect(() =>
		Schema.decodeUnknownSync(bookData)({
			mine: null,
			services: { rows: [{ id: 'not-a-record-id', name: 'Invalid service' }], next: null },
			helpers: null
		})
	).toThrow();
	expect(() =>
		Schema.decodeUnknownSync(bookData)({
			mine: null,
			services: { rows: [], next: 'not-a-page-cursor' },
			helpers: null
		})
	).toThrow();
	expect(() =>
		Schema.decodeUnknownSync(visitsData)({
			visits: { rows: [], next: 'not-a-page-cursor' },
			notices: null
		})
	).toThrow();
});
