import test from 'node:test';
import assert from 'node:assert/strict';
import {
	startSessionGateway,
	workspaceDocumentHtml
} from '@norbital-ai/bolt-server';
import {
	authoredSeedStages,
	guestUrlForObscura,
	MissingObscuraError,
	startObscura
} from '@norbital-ai/test-utilities';
import playwrightCore from 'playwright-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';

const { chromium } = playwrightCore;
import {
	publicSeedDirectory,
	startPublicSeedHost,
	templateManifestPath
} from './helpers/public-seed-host.ts';

const LOCAL_DATABASE_TEST_TIMEOUT_MILLIS = 120_000;
const HEADED_SYNC_TIMEOUT_MILLIS = 180_000;
const S1_TENANT = 'hr-payroll-s1';
const S1_EVALUATE_TIMEOUT_MS = 45_000;
const S4_IDLE_MS = 8_000;

const guestPageUrl = (
	obscura: Awaited<ReturnType<typeof startObscura>>,
	host: string,
	port: number,
	path: string
): string =>
	guestUrlForObscura(host, port, path, { rewriteLoopback: obscura.source !== 'binary' });

const isBoltDocument = (pathname: string): boolean =>
	pathname === '/__bolt' || pathname === '/__bolt/';

const rewriteBoltBrowserPath = (pathname: string): string => {
	if (pathname.startsWith('/__bolt/sync/')) return `/sync/${pathname.slice('/__bolt/sync/'.length)}`;
	if (pathname.startsWith('/__bolt/command/')) {
		return `/_bolt/command/${pathname.slice('/__bolt/command/'.length)}`;
	}
	return pathname;
};

const EVENT_SOURCE_PROBE = (): void => {
	const probeWindow = window as typeof window & {
		__probeES?: Array<EventSource & { __probeUrl?: string; __probeId?: string }>;
		__probeESWrapped?: boolean;
	};
	if (probeWindow.__probeESWrapped === true) return;
	probeWindow.__probeES = [];
	probeWindow.__probeESWrapped = true;
	const OriginalEventSource = window.EventSource;
	const ProbedEventSource = function EventSource(
		this: EventSource,
		url: string | URL,
		init?: EventSourceInit
	) {
		const source = new OriginalEventSource(url, init) as EventSource & {
			__probeUrl?: string;
			__probeId?: string;
		};
		source.__probeUrl = String(url);
		source.__probeId = crypto.randomUUID();
		probeWindow.__probeES?.push(source);
		return source;
	} as unknown as typeof EventSource;
	ProbedEventSource.prototype = OriginalEventSource.prototype;
	window.EventSource = ProbedEventSource;
};

const connectObscura = async (
	endpoint: string
): Promise<{ readonly browser: Browser; readonly context: BrowserContext }> => {
	const browser = await chromium.connectOverCDP(endpoint);
	const context = browser.contexts()[0] ?? (await browser.newContext());
	return { browser, context };
};

/**
 * T6: Obscura headed probe against the HR template self-host.
 * Not Colony :5173. Not the fixture-bundle probe. Does not accept H / B rows.
 */
test(
	'Obscura headed probe against the HR self-host sees a visible document',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async (t) => {
		const stages = authoredSeedStages(templateManifestPath, publicSeedDirectory);
		assert.ok(stages.includes('companies'), 'public seed must include companies');

		const session = await startPublicSeedHost('hr-payroll-t6', { host: '0.0.0.0' });
		let obscura: Awaited<ReturnType<typeof startObscura>> | undefined;
		let browser: Browser | undefined;
		try {
			const ready = await fetch(`${session.host.baseUrl}/readyz`);
			assert.equal(ready.status, 200);
			const snapshot = (await ready.json()) as { readonly ready?: unknown };
			assert.equal(snapshot.ready, true);
			assert.notEqual(session.host.address.port, 0);

			try {
				obscura = await startObscura();
			} catch (error) {
				if (error instanceof MissingObscuraError) {
					t.skip(`missing_obscura: ${error.message}`);
					return;
				}
				throw error;
			}

			const pageUrl = guestPageUrl(
				obscura,
				session.host.address.host,
				session.host.address.port,
				'/readyz'
			);
			assert.match(pageUrl, /readyz$/);
			assert.doesNotMatch(pageUrl, /5173|__bolt/);

			const connected = await connectObscura(obscura.endpoint);
			browser = connected.browser;
			const page = await connected.context.newPage();
			await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
			const visibility = await page.evaluate(() =>
				JSON.stringify({
					hidden: document.hidden,
					visibilityState: document.visibilityState,
					url: location.href,
					body: document.body ? document.body.innerText : ''
				})
			);
			const parsed = JSON.parse(visibility) as {
				readonly hidden: unknown;
				readonly visibilityState: unknown;
				readonly url: unknown;
				readonly body: unknown;
			};
			assert.equal(parsed.hidden, false, `document.hidden must be false: ${visibility}`);
			assert.equal(parsed.visibilityState, 'visible');
			assert.equal(typeof parsed.url, 'string');
			assert.match(String(parsed.url), /readyz/);
			assert.match(String(parsed.body), /"ready"\s*:\s*true/);
		} finally {
			if (browser !== undefined) await browser.close();
			if (obscura !== undefined) await obscura.stop();
			await session.stop();
		}
	}
);

type SyncProbe = {
	readonly hidden: unknown;
	readonly visibilityState?: unknown;
	readonly url?: unknown;
	readonly constructed: number;
	readonly open: number;
	readonly readyStates?: readonly number[];
	readonly ids?: readonly string[];
	readonly body?: string;
};

const parseProbe = (value: unknown, label: string): SyncProbe => {
	assert.equal(typeof value, 'string', `${label} must return JSON: ${String(value)}`);
	const parsed = JSON.parse(value as string) as SyncProbe;
	assert.equal(typeof parsed.constructed, 'number', `${label} missing constructed`);
	assert.equal(typeof parsed.open, 'number', `${label} missing open`);
	return parsed;
};

const tab1Probe = (): string | null => {
	const list = (
		(window as typeof window & { __probeES?: Array<EventSource & { __probeUrl?: string; __probeId?: string }> })
			.__probeES ?? []
	).filter((entry) => /\/__bolt\/sync\/stream/.test(entry.__probeUrl ?? ''));
	const open = list.filter((entry) => entry.readyState === 1);
	const body = document.body ? document.body.innerText : '';
	const painted = /Employee|Payroll|Leave|Up to date|could not|error/i.test(body);
	if (document.hidden === true) return null;
	if (open.length !== 1 || !painted) return null;
	return JSON.stringify({
		hidden: document.hidden,
		visibilityState: document.visibilityState,
		url: location.href,
		constructed: list.length,
		open: open.length,
		readyStates: list.map((entry) => entry.readyState),
		ids: list.map((entry) => entry.__probeId ?? ''),
		body: body.slice(0, 800)
	});
};

const tab2Probe = (): string | null => {
	const list = (
		(window as typeof window & { __probeES?: Array<EventSource & { __probeUrl?: string; __probeId?: string }> })
			.__probeES ?? []
	).filter((entry) => /\/__bolt\/sync\/stream/.test(entry.__probeUrl ?? ''));
	const body = document.body ? document.body.innerText : '';
	const painted = /Employee|Payroll|Leave|Up to date|could not|error/i.test(body);
	if (!painted) return null;
	return JSON.stringify({
		hidden: document.hidden,
		visibilityState: document.visibilityState,
		url: location.href,
		constructed: list.length,
		open: list.filter((entry) => entry.readyState === 1).length,
		readyStates: list.map((entry) => entry.readyState),
		ids: list.map((entry) => entry.__probeId ?? ''),
		body: body.slice(0, 800)
	});
};

const tab1IdleProbe = (): string => {
	const list = (
		(window as typeof window & { __probeES?: Array<EventSource & { __probeUrl?: string; __probeId?: string }> })
			.__probeES ?? []
	).filter((entry) => /\/__bolt\/sync\/stream/.test(entry.__probeUrl ?? ''));
	return JSON.stringify({
		hidden: document.hidden,
		visibilityState: document.visibilityState,
		url: location.href,
		constructed: list.length,
		open: list.filter((entry) => entry.readyState === 1).length,
		readyStates: list.map((entry) => entry.readyState),
		ids: list.map((entry) => entry.__probeId ?? '')
	});
};

const lockSnapshot = async (): Promise<string> => {
	const locks = navigator.locks;
	if (locks === undefined) return JSON.stringify({ locks: 'missing' });
	const snapshot = await locks.query();
	return JSON.stringify({
		origin: location.origin,
		held: snapshot.held?.map((lock) => ({ name: lock.name, mode: lock.mode })),
		pending: snapshot.pending?.map((lock) => ({ name: lock.name, mode: lock.mode }))
	});
};

const waitForProbe = async (
	page: Page,
	probe: () => string | null,
	label: string
): Promise<SyncProbe> => parseProbe(await (await page.waitForFunction(probe, { timeout: S1_EVALUATE_TIMEOUT_MS })).jsonValue(), label);

/**
 * S1 / S3 / S4 on the HR template self-host (T6 pattern).
 * Cookie → Bearer gateway at /__bolt. Not Colony :5173. Not the private bank.
 */
test(
	'HR self-host keeps one EventSource per profile; second tab adds none',
	{ timeout: HEADED_SYNC_TIMEOUT_MILLIS },
	async (t) => {
		const session = await startPublicSeedHost(S1_TENANT, { host: '0.0.0.0' });
		let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
		let obscura: Awaited<ReturnType<typeof startObscura>> | undefined;
		let browser: Browser | undefined;
		try {
			const ready = await fetch(`${session.host.baseUrl}/readyz`);
			assert.equal(ready.status, 200);

			gateway = await startSessionGateway({
				upstream: session.host.address,
				credential: session.credential,
				cookieName: 'norbital_headed',
				listen: { host: '0.0.0.0' },
				isDocument: isBoltDocument,
				rewritePath: rewriteBoltBrowserPath,
				document: workspaceDocumentHtml({
					tenantId: S1_TENANT,
					workspaceId: S1_TENANT,
					environment: 'test',
					releaseId: S1_TENANT,
					principal: `${S1_TENANT}-founder`,
					syncPrincipal: `${S1_TENANT}-founder`,
					organizationName: 'HR payroll public seed',
					commandPrefix: '/__bolt/command/',
					syncStreamUrl: '/__bolt/sync/stream',
					viewPath: '/__bolt'
				})
			});

			try {
				obscura = await startObscura();
			} catch (error) {
				if (error instanceof MissingObscuraError) {
					t.skip(`missing_obscura: ${error.message}`);
					return;
				}
				throw error;
			}

			const pageUrl = guestPageUrl(obscura, gateway.address.host, gateway.address.port, '/__bolt');
			assert.match(pageUrl, /__bolt$/);
			assert.doesNotMatch(pageUrl, /5173|readyz/);

			const connected = await connectObscura(obscura.endpoint);
			browser = connected.browser;
			await connected.context.addInitScript(EVENT_SOURCE_PROBE);

			const tab1 = await connected.context.newPage();
			await tab1.goto(pageUrl, { waitUntil: 'domcontentloaded' });
			const first = await waitForProbe(tab1, tab1Probe, 'tab1');
			assert.equal(first.hidden, false, `document.hidden must be false: ${JSON.stringify(first)}`);
			assert.equal(first.visibilityState, 'visible');
			assert.match(String(first.url), /__bolt/);
			assert.equal(first.constructed, 1, `S1 tab1 constructed: ${JSON.stringify(first)}`);
			assert.equal(first.open, 1, `S1 tab1 open: ${JSON.stringify(first)}`);
			assert.deepEqual(first.readyStates, [1]);
			assert.equal(first.ids?.length, 1);
			assert.match(
				String(first.body),
				/Employee|Payroll|Leave|Up to date/i,
				`S3 picker never painted: ${first.body}`
			);

			const tab2 = await connected.context.newPage();
			await tab2.goto(pageUrl, { waitUntil: 'domcontentloaded' });
			const second = await waitForProbe(tab2, tab2Probe, 'tab2');
			const tab1Locks = await tab1.evaluate(lockSnapshot);
			const tab2Locks = await tab2.evaluate(lockSnapshot);
			assert.equal(
				second.constructed,
				0,
				`S1 tab2 must add no stream: ${JSON.stringify(second)} tab1Locks=${tab1Locks} tab2Locks=${tab2Locks}`
			);
			assert.equal(second.open, 0, `S1 tab2 open: ${JSON.stringify(second)} tab2Locks=${tab2Locks}`);

			const afterTab2 = parseProbe(await tab1.evaluate(tab1IdleProbe), 'tab1-after-tab2');
			assert.equal(afterTab2.constructed, 1);
			assert.equal(afterTab2.open, 1);
			assert.deepEqual(afterTab2.ids, first.ids);

			await new Promise((resolve) => setTimeout(resolve, S4_IDLE_MS));
			const idle = parseProbe(await tab1.evaluate(tab1IdleProbe), 'tab1-idle');
			assert.equal(idle.url, first.url, 'S4 URL remounted');
			assert.equal(idle.constructed, 1, `S4 constructed: ${JSON.stringify(idle)}`);
			assert.equal(idle.open, 1, `S4 stream dropped: ${JSON.stringify(idle)}`);
			assert.deepEqual(idle.ids, first.ids, 'S4 stream id changed');
		} finally {
			if (browser !== undefined) await browser.close();
			if (obscura !== undefined) await obscura.stop();
			if (gateway !== undefined) await gateway.stop();
			await session.stop();
		}
	}
);
