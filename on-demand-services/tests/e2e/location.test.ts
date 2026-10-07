// @vitest-environment happy-dom
/** The real helper page, signed-in HTTP handlers and database; only the GPS hardware is simulated. */
import { expect, it, vi } from 'vitest';
import { unmount } from 'svelte';
import { _api as icons } from '@iconify/svelte';
import { testWorkspace } from '@norbital-ai/bolt/test';
import {
	Authorities,
	RateWindows,
	boltHandler,
	loadKeys,
	mint,
	shellHost,
	devTurnstile,
	COOKIES,
	type IdentityHost
} from '@norbital-ai/bolt/engine';
import { bolt } from '@norbital-ai/bolt/client';
import EmployeeSession from '../../src/app/helper/+session.svelte';
import { mountShell } from '@norbital-ai/bolt/test/browser';

it.each(['native', 'browser'] as const)(
	'uses %s GPS and commits the helper position through authenticated HTTP, keeps tracking across shell navigation, gates permission loss, then stops with the session',
	async (source) => {
		const t = await testWorkspace({
			root: process.cwd(),
			seed: 'base',
			now: new Date().toISOString()
		});
		const helper = '0d500002-0000-4000-8000-000000000001';
		const member = t.member(['helper']);
		expect(
			await t.as(t.admin).act('helpers.update', { target: helper, set: { user: member.id } })
		).toMatchObject({ kind: 'committed' });
		await t.db.write({
			text: `INSERT INTO sys_assignment (id, principal_type, principal, policy) VALUES ($1, 'sys_user', $2, 'helper')`,
			params: [crypto.randomUUID(), member.id]
		});
		const mail = { send: async () => ({ providerId: 'location-test' }), subscribe: () => () => {} };
		const identity: IdentityHost = {
			db: t.db,
			now: () => new Date(t.clock.now()),
			windows: new RateWindows(),
			keys: await loadKeys(t.db),
			mail,
			sms: mail,
			devSink: true,
			publicUrl: 'http://localhost'
		};
		const session = await mint(identity, member.id);
		if (!session.ok) throw new Error(session.message);
		const shell = shellHost({
			manifest: t.manifest,
			identity,
			authorities: new Authorities(t.manifest, 'location-test'),
			workspace: { name: 'Location test', handle: 'location-test' },
			ip: () => '203.0.113.50',
			turnstile: devTurnstile,
			secure: false
		});
		const handler = boltHandler({
			engine: t.engine,
			session: shell.authority,
			uuid: () => crypto.randomUUID(),
			bindings: () => ({
				now: t.clock.now(),
				today: t.clock.now().slice(0, 10),
				tz: t.manifest.workspace.tz,
				params: {}
			})
		});
		const mutations: unknown[] = [];
		const requests: string[] = [];
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const url = new URL(
				typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
				'http://localhost'
			);
			const request = new Request(url, init);
			request.headers.set(
				'cookie',
				`${COOKIES.session}=${encodeURIComponent(session.value.token)}`
			);
			const response =
				(await shell.handle(request)) ??
				(await handler(request)) ??
				new Response(null, { status: 404 });
			requests.push(`${init?.method ?? 'GET'} ${url.pathname} ${response.status}`);
			if (url.pathname.endsWith('/__bolt/act'))
				mutations.push(((await response.clone().json()) as { outcome: unknown }).outcome);
			return response;
		};
		// Icon CDN access is outside this local workflow test.
		const iconFetch = icons.getFetch();
		icons.setFetch(async () => new Response('{}', { status: 404 }));
		vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
		const streams: (() => void)[] = [];
		const openStream = (url: string) => {
			const source = {
				onmessage: null as ((e: MessageEvent<string>) => void) | null,
				onerror: null as ((e: Event) => void) | null,
				close: () => {}
			};
			const abort = new AbortController();
			source.close = () => abort.abort();
			streams.push(source.close);
			void (async () => {
				try {
					const reader = (await fetch(url, { signal: abort.signal })).body!.getReader();
					const decoder = new TextDecoder();
					let buffer = '';
					for (;;) {
						const { value, done } = await reader.read();
						if (done) return;
						buffer += decoder.decode(value, { stream: true });
						for (let at = buffer.indexOf('\n\n'); at >= 0; at = buffer.indexOf('\n\n')) {
							const data = buffer
								.slice(0, at)
								.split('\n')
								.filter((line) => line.startsWith('data: '))
								.map((line) => line.slice(6))
								.join('\n');
							buffer = buffer.slice(at + 2);
							if (data) source.onmessage?.(new MessageEvent('message', { data }));
						}
					}
				} catch (error) {
					if (!abort.signal.aborted) throw error;
				}
			})();
			return source;
		};
		let success: PositionCallback | undefined;
		let failure: PositionErrorCallback | undefined;
		let always = false;
		const background = {
			status: vi.fn(async () => ({ enabled: true, always })),
			openSettings: vi.fn(async () => undefined)
		};
		const native = {
			watchPosition: vi.fn((callback: PositionCallback, error: PositionErrorCallback) => {
				success = callback;
				failure = error;
				return 7;
			}),
			clearWatch: vi.fn(),
			getCurrentPosition: vi.fn((ok: PositionCallback) => {
				asked = true;
				ok({
					coords: { latitude: 1.301, longitude: 103.801 },
					timestamp: Date.now()
				} as GeolocationPosition);
			})
		} as unknown as Geolocation;
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
			openSettings: vi.fn(async () => undefined)
		};
		const browser = { watchPosition: vi.fn() };
		const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
		Object.defineProperty(navigator, 'geolocation', {
			configurable: true,
			value: source === 'native' ? browser : native
		});
		(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
			'http://localhost/'
		);
		const target = document.createElement('div');
		document.body.append(target);
		const view = mountShell(target, {
			manifest: t.manifest as never,
			sessions: { helper: EmployeeSession },
			pages: { 'helper/today': () => import('../../src/app/helper/+today.page.svelte') },
			fetch,
			facilities:
				source === 'native'
					? { geolocation: { source: 'native' as const, api: native, background }, notifications }
					: { notifications },
			openStream
		});
		try {
			try {
				await vi.waitFor(() => expect(native.watchPosition).toHaveBeenCalledOnce(), {
					timeout: 5000
				});
			} catch (error) {
				throw new Error(JSON.stringify({ requests, page: target.textContent }), { cause: error });
			}
			expect(browser.watchPosition).not.toHaveBeenCalled();
			expect(bolt.facilities.geolocation?.source).toBe(source);
			success!({
				coords: { latitude: 1.301, longitude: 103.801 },
				timestamp: Date.now()
			} as GeolocationPosition);
			await vi.waitFor(() =>
				expect(mutations).toContainEqual(expect.objectContaining({ kind: 'committed' }))
			);
			// the app itself waits behind the shell's device wall until its `requires` are met
			history.pushState(null, '', '/app/helper/today');
			window.dispatchEvent(new PopStateEvent('popstate'));
			const wall = () => target.querySelector('[data-device-wall]');
			await vi.waitFor(() => expect(wall()).not.toBeNull(), { timeout: 5000 });
			expect(target.querySelector('#route-date')).toBeNull();
			if (source === 'native') {
				// a foreground fix is not enough: background tracking needs "Always"
				expect(
					wall()!
						.querySelector('[data-requirement="location:background"]')!
						.getAttribute('data-state')
				).toBe('denied');
				always = true;
				await vi.waitFor(() => expect(wall()).toBeNull(), { timeout: 5000 });
				always = false;
				await vi.waitFor(() => expect(wall()).not.toBeNull(), { timeout: 5000 });
				always = true;
			} else {
				// a browser asks: Allow takes a position, and the app opens
				(
					wall()!.querySelector(
						'[data-requirement="location:background"] button'
					) as HTMLButtonElement
				).click();
			}
			await vi.waitFor(() => expect(target.querySelector('#route-date')).not.toBeNull(), {
				timeout: 5000
			});
			expect(native.clearWatch).not.toHaveBeenCalled();
			const row = await t.as(member).get('helpers', helper);
			expect(row).toMatchObject({
				last_location: { lat: 1.301, lng: 103.801 },
				last_location_at: { $t: t.clock.now() }
			});
			// The location facility does not expand the helper's authority to another helper.
			expect(
				await t.as(member).act('helpers.update', {
					target: '0d500002-0000-4000-8000-000000000002',
					set: { last_location: { lat: 1.301, lng: 103.801 } }
				})
			).toMatchObject({ kind: 'refused' });
		} finally {
			await unmount(view);
			for (const close of streams) close();
			target.remove();
			if (iconFetch) icons.setFetch(iconFetch);
			vi.unstubAllGlobals();
			if (permissions) Object.defineProperty(navigator, 'permissions', permissions);
			else Reflect.deleteProperty(navigator, 'permissions');
			if (original) Object.defineProperty(navigator, 'geolocation', original);
			else Reflect.deleteProperty(navigator, 'geolocation');
		}
		expect(native.clearWatch).toHaveBeenCalledWith(7);
		expect(browser.watchPosition).not.toHaveBeenCalled();
	}
);
