import { present } from '../test-runtime.js';
import { Cause, Effect, Fiber, FiberSet, Schema, Stream } from 'effect';
import { Sse } from 'effect/unstable/encoding';
// @vitest-environment happy-dom
/** The real helper page, signed-in HTTP handlers and database; only the GPS hardware is simulated. */
import { expect, it, vi } from '@effect/vitest';
import { _api as icons } from '@iconify/svelte';
import { workspace as acquireWorkspace, fixtureId } from '../test-runtime.js';
import { bolt } from '@norbital-ai/bolt/page';
import EmployeeSession from '../../src/app/helper/+session.svelte';
import { mountShell, type ShellMountConfig } from '@norbital-ai/bolt/test/browser';
const position = (): GeolocationPosition => {
	const values = {
		latitude: 1.301,
		longitude: 103.801,
		accuracy: 5,
		altitude: null,
		altitudeAccuracy: null,
		heading: null,
		speed: null
	};
	const coords: GeolocationCoordinates = { ...values, toJSON: () => values };
	const timestamp = Date.now();
	return { coords, timestamp, toJSON: () => ({ coords: values, timestamp }) };
};
it.live.each(['native', 'browser'] as const)(
	'uses %s GPS and commits the helper position through authenticated HTTP, keeps tracking across shell navigation, gates permission loss, then stops with the session',
	(source) =>
		Effect.gen(function* () {
			const t = yield* acquireWorkspace({
				root: process.cwd(),
				seed: 'base',
				now: new Date().toISOString()
			});
			const helper = fixtureId('helpers', '0d500002-0000-4000-8000-000000000001');
			const member = t.member(['helper'], {
				teams: ['team-helpers'],
				teamPath: ['team-helpers']
			});
			expect(
				yield* t.as(t.admin).act('helpers.update', {
					target: helper,
					set: { user: fixtureId('sys_user', member.id) }
				})
			).toMatchObject({ kind: 'committed' });
			const session = yield* t.session(member.id);
			const run = yield* FiberSet.makeRuntimePromise();
			const hostedStreams = yield* FiberSet.make<void, never>();
			const mutations: unknown[] = [];
			const requests: string[] = [];
			const liveRequests: string[] = [];
			const fetch: typeof globalThis.fetch = async (input, init) => {
				const url = new URL(
					typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
					'http://localhost'
				);
				const request = new Request(url, input instanceof Request ? input : init);
				if (url.pathname === '/__bolt/live' && request.method === 'POST')
					liveRequests.push(await request.clone().text());
				request.headers.set('cookie', session);
				const response = await run(t.handle(request).pipe(Effect.provide(t.services)), {
					signal: init?.signal ?? (input instanceof Request ? input.signal : undefined)
				});
				requests.push(`${request.method} ${url.pathname} ${response.status}`);
				if (url.pathname.endsWith('/__bolt/act'))
					mutations.push(
						Schema.decodeUnknownSync(Schema.Struct({ outcome: Schema.Unknown }))(
							await response.clone().json()
						).outcome
					);
				return response;
			};
			// Icon CDN access is outside this local workflow test.
			const iconFetch = icons.getFetch();
			icons.setFetch(async () => new Response('{}', { status: 404 }));
			vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
			const streams: (() => void)[] = [];
			const openStream = (url: string) => {
				let fiber: Fiber.Fiber<void, never> | undefined;
				let closed = false;
				const source: ReturnType<NonNullable<ShellMountConfig['openStream']>> = {
					onmessage: null,
					onerror: null,
					close: () => {
						closed = true;
						if (fiber !== undefined) void run(Fiber.interrupt(fiber));
					}
				};
				streams.push(source.close);
				const consume = Effect.gen(function* () {
					const response = yield* Effect.tryPromise({
						try: (signal) => fetch(url, { signal }),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
					if (response.body === null)
						return yield* Effect.fail(
							new TestIoFailed({ message: 'The live response has no body.' })
						);
					const body = response.body;
					yield* Stream.fromReadableStream({
						evaluate: () => body,
						onError: (cause) => new TestIoFailed({ message: String(cause) })
					}).pipe(
						Stream.decodeText(),
						Stream.pipeThroughChannel(Sse.decode()),
						Stream.runForEach((event) =>
							Effect.sync(() => {
								source.onmessage?.(new MessageEvent('message', { data: event.data }));
							})
						)
					);
				}).pipe(
					Effect.catchCause((cause) =>
						Cause.hasInterruptsOnly(cause)
							? Effect.void
							: Effect.logWarning(cause).pipe(
									Effect.andThen(
										Effect.sync(() => {
											if (!closed) source.onerror?.(new Event('error'));
										})
									)
								)
					)
				);
				void run(FiberSet.run(hostedStreams, consume)).then((started) => {
					fiber = started;
					if (closed) void run(Fiber.interrupt(started));
				});
				return source;
			};
			let success: PositionCallback | undefined;
			let always = false;
			const background = {
				status: vi.fn(async () => ({ enabled: true, always })),
				openSettings: vi.fn(async () => undefined)
			};
			const native = {
				watchPosition: vi.fn((callback: PositionCallback) => {
					success = callback;
					return 7;
				}),
				clearWatch: vi.fn(),
				getCurrentPosition: vi.fn((ok: PositionCallback) => {
					asked = true;
					ok(position());
				})
			} satisfies Geolocation;
			// a browser that has not been asked yet: geolocation is `prompt` until the wall's Allow takes a position
			let asked = false;
			const permissions = Object.getOwnPropertyDescriptor(navigator, 'permissions');
			Object.defineProperty(navigator, 'permissions', {
				configurable: true,
				value: { query: async () => ({ state: asked ? 'granted' : 'prompt' }) }
			});
			// notifications are the other half of the helper app's `requires`: granted here, so location decides the wall
			const notifications = {
				status: vi.fn(async () => 'granted' as const),
				request: vi.fn(async () => 'granted' as const),
				openSettings: vi.fn(async () => undefined),
				show: vi.fn(async () => undefined),
				onOpen: vi.fn(() => () => undefined)
			};
			const browser = { watchPosition: vi.fn() };
			const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
			Object.defineProperty(navigator, 'geolocation', {
				configurable: true,
				value: source === 'native' ? browser : native
			});
			history.replaceState(null, '', '/');
			const target = document.createElement('div');
			document.body.append(target);
			vi.stubEnv('TZ', 'Asia/Tokyo');
			const view = mountShell(target, {
				manifest: t.manifest,
				sessions: { helper: EmployeeSession },
				pages: { 'helper/today': () => import('../../src/app/helper/+today.page.svelte') },
				fetch,
				device:
					source === 'native'
						? { geolocation: { source: 'native' as const, api: native, background }, notifications }
						: { notifications },
				openStream
			});
			try {
				try {
					yield* Effect.tryPromise({
						try: () =>
							vi.waitFor(() => expect(native.watchPosition).toHaveBeenCalledOnce(), {
								timeout: 5000
							}),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
				} catch (error) {
					throw new Error(JSON.stringify({ requests, page: target.textContent }), { cause: error });
				}
				expect(browser.watchPosition).not.toHaveBeenCalled();
				expect(bolt.device.geolocation?.source).toBe(source);
				if (success === undefined) throw new Error('Missing geolocation watch callback');
				success(position());
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() =>
							expect(mutations).toContainEqual(expect.objectContaining({ kind: 'committed' }))
						),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				// the app itself waits behind the shell's device wall until its `requires` are met
				history.pushState(null, '', '/app/helper/today');
				window.dispatchEvent(new PopStateEvent('popstate'));
				const wall = () => target.querySelector('[data-device-wall]');
				yield* Effect.tryPromise({
					try: () => vi.waitFor(() => expect(wall()).not.toBeNull(), { timeout: 5000 }),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				expect(target.querySelector('#route-date')).toBeNull();
				if (source === 'native') {
					// a foreground fix is not enough: background tracking needs "Always"
					expect(
						present(
							present(wall()).querySelector('[data-requirement="location:background"]')
						).getAttribute('data-state')
					).toBe('denied');
					always = true;
					yield* Effect.tryPromise({
						try: () => vi.waitFor(() => expect(wall()).toBeNull(), { timeout: 5000 }),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
					always = false;
					yield* Effect.tryPromise({
						try: () => vi.waitFor(() => expect(wall()).not.toBeNull(), { timeout: 5000 }),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					});
					always = true;
				} else {
					// a browser asks: Allow takes a position, and the app opens
					const allow = wall()?.querySelector('[data-requirement="location:background"] button');
					if (!(allow instanceof HTMLButtonElement))
						throw new Error('Missing location Allow control');
					allow.click();
				}
				yield* Effect.tryPromise({
					try: () =>
						vi.waitFor(() => expect(target.querySelector('#route-date')).not.toBeNull(), {
							timeout: 5000
						}),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(
					new Date()
				);
				const start = new Date(`${day}T00:00:00+08:00`);
				const end = new Date(start.getTime() + 86400000);
				expect(
					liveRequests.some(
						(body) =>
							body.includes('visits') &&
							body.includes('overlaps') &&
							body.includes(start.toISOString()) &&
							body.includes(end.toISOString())
					)
				).toBe(true);
				expect(native.clearWatch).not.toHaveBeenCalled();
				const row = yield* t.as(member).get('helpers', helper);
				expect(row).toMatchObject({
					last_location: { lat: 1.301, lng: 103.801 },
					last_location_at: t.clock.now()
				});
				// The location facility does not expand the helper's authority to another helper.
				expect(
					yield* Effect.flip(
						t.as(member).act('helpers.update', {
							target: fixtureId('helpers', '0d500002-0000-4000-8000-000000000002'),
							set: { last_location: { lat: 1.301, lng: 103.801 } }
						})
					)
				).toMatchObject({ _tag: 'ActRefused' });
			} finally {
				yield* Effect.tryPromise({
					try: () => view(),
					catch: (cause) => new TestIoFailed({ message: String(cause) })
				});
				for (const close of streams) close();
				target.remove();
				if (iconFetch) icons.setFetch(iconFetch);
				vi.unstubAllGlobals();
				vi.unstubAllEnvs();
				if (permissions) Object.defineProperty(navigator, 'permissions', permissions);
				else Reflect.deleteProperty(navigator, 'permissions');
				if (original) Object.defineProperty(navigator, 'geolocation', original);
				else Reflect.deleteProperty(navigator, 'geolocation');
			}
			expect(native.clearWatch).toHaveBeenCalledWith(7);
			expect(browser.watchPosition).not.toHaveBeenCalled();
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
