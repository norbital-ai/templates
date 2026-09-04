import { it } from 'vitest';
import assert from 'node:assert/strict';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import {
	authoredSeedStages,
	bearerHeaders,
	guestUrlForChromium,
	isHeadedRun,
	launchChromiumOrSkip,
	postGuestCommand,
	type HeadedBrowser,
	type HeadedPage
} from '@norbital-ai/test-utilities';
import {
	JURISDICTION_ID,
	publicSeedDirectory,
	startPublicSeedHost,
	templateManifestPath
} from '../helpers/public-seed-host.ts';

const S1_TENANT = 'hr-payroll-s1';
const S1_EVALUATE_TIMEOUT_MS = 45_000;
const S4_IDLE_MS = 8_000;
const HEADED_RUN = isHeadedRun();

const guestPageUrl = (port: number, path: string): string =>
	guestUrlForChromium('127.0.0.1', port, path);

const isBoltDocument = (pathname: string): boolean =>
	pathname === '/__bolt' ||
	pathname === '/__bolt/' ||
	pathname === '/' ||
	pathname.startsWith('/app/');

const rewriteBoltBrowserPath = (pathname: string): string => {
	if (pathname.startsWith('/__bolt/sync/'))
		return `/sync/${pathname.slice('/__bolt/sync/'.length)}`;
	if (pathname.startsWith('/__bolt/command/')) {
		return `/_bolt/command/${pathname.slice('/__bolt/command/'.length)}`;
	}
	return pathname;
};

const EVENT_SOURCE_PROBE = `(() => {
	if (window.__probeESWrapped === true) return;

	window.__probeES = [];
	window.__probeESWrapped = true;
	const OriginalEventSource = window.EventSource;
	window.EventSource = function EventSource(url, init) {
		const source = new OriginalEventSource(url, init);
		source.__probeUrl = String(url);
		source.__probeId = crypto.randomUUID();
		window.__probeES.push(source);
		return source;
	};
	window.EventSource.prototype = OriginalEventSource.prototype;
})();`;

const TAB1_PROBE = `(() => {
	const list = (window.__probeES ?? []).filter((entry) =>
		/\\/__bolt\\/sync\\/stream/.test(entry.__probeUrl ?? '')
	);
	const open = list.filter((entry) => entry.readyState === 1);
	const body = document.body ? document.body.innerText : '';
	const painted = /Employee|Payroll|Leave|Up to date|could not|error/i.test(body);
	if (document.hidden === true && ${HEADED_RUN}) return null;
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
})()`;

const TAB2_PROBE = `(() => {
	const list = (window.__probeES ?? []).filter((entry) =>
		/\\/__bolt\\/sync\\/stream/.test(entry.__probeUrl ?? '')
	);
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
})()`;

const TAB1_IDLE_PROBE = `(() => {
	const list = (window.__probeES ?? []).filter((entry) =>
		/\\/__bolt\\/sync\\/stream/.test(entry.__probeUrl ?? '')
	);
	return JSON.stringify({
		hidden: document.hidden,
		visibilityState: document.visibilityState,
		url: location.href,
		constructed: list.length,
		open: list.filter((entry) => entry.readyState === 1).length,
		readyStates: list.map((entry) => entry.readyState),
		ids: list.map((entry) => entry.__probeId ?? '')
	});
})()`;

const LOCK_SNAPSHOT = `(async () => {
	const locks = navigator.locks;
	if (locks === undefined) return JSON.stringify({ locks: 'missing' });
	const snapshot = await locks.query();
	return JSON.stringify({
		origin: location.origin,
		held: snapshot.held?.map((lock) => ({ name: lock.name, mode: lock.mode })),
		pending: snapshot.pending?.map((lock) => ({ name: lock.name, mode: lock.mode }))
	});
})()`;

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
	assert.ok(typeof value === 'string', `${label} must return JSON: ${String(value)}`);
	const parsed = JSON.parse(value) as SyncProbe;
	assert.equal(typeof parsed.constructed, 'number', `${label} missing constructed`);
	assert.equal(typeof parsed.open, 'number', `${label} missing open`);
	return parsed;
};

const waitForProbe = async (
	page: HeadedPage,
	expression: string,
	label: string
): Promise<SyncProbe> => {
	const deadline = Date.now() + S1_EVALUATE_TIMEOUT_MS;
	let last: unknown = null;
	while (Date.now() < deadline) {
		last = await page.evaluate(expression);
		if (typeof last === 'string') return parseProbe(last, label);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`${label} timeout: ${String(last)}`);
};

const syncStreamStatusOf = async (page: HeadedPage): Promise<string> =>
	`es=${String(
		await page.evaluate(
			`JSON.stringify((window.__probeES ?? []).map((entry) => ({ readyState: entry.readyState, url: entry.__probeUrl })))`
		)
	)}`;

const openHrGateway = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	label: string,
	viewPath = '/__bolt'
) =>
	startSessionGateway({
		upstream: session.host.address,
		credential: session.credential,
		cookieName: 'norbital_headed',
		listen: { host: '0.0.0.0' },
		isDocument: isBoltDocument,
		rewritePath: rewriteBoltBrowserPath,
		document: ({ browserSession }) =>
			workspaceDocumentHtml({
				tenantId: label,
				workspaceId: label,
				environment: 'test',
				releaseId: label,
				principal: `${label}-founder`,
				syncPrincipal: `${label}-founder`,
				organizationName: 'HR payroll public seed',
				commandPrefix: '/__bolt/command/',
				syncStreamUrl: `/__bolt/sync/stream?norbital_headed=${browserSession}`,
				viewPath,
				accessScope: 'operator',
				credential: session.credential
			})
	});

/**
 * T6: headed Chromium probe against the HR template self-host.
 * Not Colony :5173. Not the fixture-bundle probe. Does not accept H / B rows.
 */
it('Headed Chromium probe against the HR self-host sees a visible document', async () => {
	const stages = authoredSeedStages(templateManifestPath, publicSeedDirectory);
	assert.ok(stages.includes('companies'), 'public seed must include companies');

	const session = await startPublicSeedHost('hr-payroll-t6', { host: '0.0.0.0' });
	let browser: HeadedBrowser | undefined;
	try {
		const ready = await fetch(`${session.host.baseUrl}/readyz`);
		assert.equal(ready.status, 200);
		const snapshot = (await ready.json()) as { readonly ready?: unknown };
		assert.equal(snapshot.ready, true);
		assert.notEqual(session.host.address.port, 0);

		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;

		const pageUrl = guestPageUrl(session.host.address.port, '/readyz');
		assert.match(pageUrl, /readyz$/);
		assert.doesNotMatch(pageUrl, /5173|__bolt/);

		const page = await browser.openPage(pageUrl);
		const visibility = await page.evaluate(`JSON.stringify({
					hidden: document.hidden,
					visibilityState: document.visibilityState,
					url: location.href,
					body: document.body ? document.body.innerText : ''
			})`);
		assert.ok(typeof visibility === 'string', `visibility must be JSON: ${String(visibility)}`);
		const parsed = JSON.parse(visibility) as {
			readonly hidden: unknown;
			readonly visibilityState: unknown;
			readonly url: unknown;
			readonly body: unknown;
		};
		if (HEADED_RUN) {
			assert.equal(parsed.hidden, false, `document.hidden must be false: ${visibility}`);
			assert.equal(parsed.visibilityState, 'visible');
		}
		assert.equal(typeof parsed.url, 'string');
		assert.match(String(parsed.url), /readyz/);
		assert.match(String(parsed.body), /"ready"\s*:\s*true/);
	} finally {
		if (browser !== undefined) await browser.close();
		await session.stop();
	}
});

/**
 * S3 / S4 on one Playwright Chromium profile. Second tab is a sibling tab (S1).
 */
it('HR self-host paints the shell and keeps one stream across 8s idle', async () => {
	const session = await startPublicSeedHost('hr-payroll-a2-form', { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		gateway = await openHrGateway(session, 'hr-payroll-s3');
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;

		const pageUrl = guestPageUrl(gateway.address.port, '/__bolt');
		assert.doesNotMatch(pageUrl, /5173|readyz/);
		const page = await browser.openPage(pageUrl);
		await page.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		const first = await waitForProbe(page, TAB1_PROBE, 's3-mount');
		if (HEADED_RUN) {
			assert.equal(first.hidden, false, `document.hidden must be false: ${JSON.stringify(first)}`);
		}
		assert.equal(first.constructed, 1, `S3 constructed: ${JSON.stringify(first)}`);
		assert.equal(first.open, 1, `S3 open: ${JSON.stringify(first)}`);
		assert.match(
			String(first.body),
			/Employee|Payroll|Leave|Up to date/i,
			`S3 shell never painted: ${first.body}`
		);

		await new Promise((resolve) => setTimeout(resolve, S4_IDLE_MS));
		const idle = parseProbe(await page.evaluate(TAB1_IDLE_PROBE), 's4-idle');
		assert.equal(idle.url, first.url, 'S4 URL remounted');
		assert.equal(idle.constructed, 1, `S4 constructed: ${JSON.stringify(idle)}`);
		assert.equal(idle.open, 1, `S4 stream dropped: ${JSON.stringify(idle)}`);
		assert.deepEqual(idle.ids, first.ids, 'S4 stream id changed');
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});

/**
 * S1 on the HR template self-host. Second tab is a sibling tab in the same browser profile;
 * Web Locks and BroadcastChannel are per origin and profile, so tab2 adds no stream.
 */
it('HR self-host keeps one EventSource per profile; second tab adds none', async () => {
	const session = await startPublicSeedHost(S1_TENANT, { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		const ready = await fetch(`${session.host.baseUrl}/readyz`);
		assert.equal(ready.status, 200);
		gateway = await openHrGateway(session, S1_TENANT);
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;

		const pageUrl = guestPageUrl(gateway.address.port, '/__bolt');
		assert.match(pageUrl, /__bolt$/);
		assert.doesNotMatch(pageUrl, /5173|readyz/);

		const tab1 = await browser.openPage(pageUrl);
		const first = await waitForProbe(tab1, TAB1_PROBE, 'tab1');
		if (HEADED_RUN) {
			assert.equal(first.hidden, false, `document.hidden must be false: ${JSON.stringify(first)}`);
			assert.equal(first.visibilityState, 'visible');
		}
		assert.match(String(first.url), /__bolt/);
		assert.equal(first.constructed, 1, `S1 tab1 constructed: ${JSON.stringify(first)}`);
		assert.equal(first.open, 1, `S1 tab1 open: ${JSON.stringify(first)}`);
		assert.deepEqual(first.readyStates, [1]);
		assert.equal(first.ids?.length, 1);
		assert.match(
			String(first.body),
			/Employee|Payroll|Leave|Up to date/i,
			`S1 shell never painted: ${first.body}`
		);

		const tab2 = await tab1.openWindow(pageUrl);
		const second = await waitForProbe(tab2, TAB2_PROBE, 'tab2');
		const tab1Locks = await tab1.evaluate(LOCK_SNAPSHOT);
		const tab2Locks = await tab2.evaluate(LOCK_SNAPSHOT);
		assert.equal(
			second.constructed,
			0,
			`S1 tab2 must add no stream: ${JSON.stringify(second)} tab1Locks=${String(tab1Locks)} tab2Locks=${String(tab2Locks)}`
		);
		assert.equal(
			second.open,
			0,
			`S1 tab2 open: ${JSON.stringify(second)} tab2Locks=${String(tab2Locks)}`
		);

		const afterTab2 = parseProbe(await tab1.evaluate(TAB1_IDLE_PROBE), 'tab1-after-tab2');
		assert.equal(afterTab2.constructed, 1);
		assert.equal(afterTab2.open, 1);
		assert.deepEqual(afterTab2.ids, first.ids);

		await new Promise((resolve) => setTimeout(resolve, S4_IDLE_MS));
		const idle = parseProbe(await tab1.evaluate(TAB1_IDLE_PROBE), 'tab1-idle');
		assert.equal(idle.url, first.url, 'S4 URL remounted');
		assert.equal(idle.constructed, 1, `S4 constructed: ${JSON.stringify(idle)}`);
		assert.equal(idle.open, 1, `S4 stream dropped: ${JSON.stringify(idle)}`);
		assert.deepEqual(idle.ids, first.ids, 'S4 stream id changed');
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});

/**
 * S2 two-target half on the HR template self-host.
 * Two Chromium profiles (own contexts) each open one stream. Same public picker.
 * Unrelated-workspace quiet and cross-profile mutation are not this close.
 */
it('HR self-host gives a second profile its own EventSource', async () => {
	const session = await startPublicSeedHost('hr-payroll-s2', { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		const ready = await fetch(`${session.host.baseUrl}/readyz`);
		assert.equal(ready.status, 200);
		gateway = await openHrGateway(session, 'hr-payroll-s2');
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;

		const pageUrl = guestPageUrl(gateway.address.port, '/__bolt');
		const pageA = await browser.openPage(pageUrl);
		const first = await waitForProbe(pageA, TAB1_PROBE, 'profile-a');
		assert.equal(first.constructed, 1, `S2 profile A constructed: ${JSON.stringify(first)}`);
		assert.equal(first.open, 1);
		assert.match(String(first.body), /Employee|Payroll|Leave|Up to date/i);

		const pageB = await browser.openPage(pageUrl, { profile: true });
		const second = await waitForProbe(pageB, TAB1_PROBE, 'profile-b');
		assert.equal(second.constructed, 1, `S2 profile B constructed: ${JSON.stringify(second)}`);
		assert.equal(second.open, 1);
		assert.match(String(second.body), /Employee|Payroll|Leave|Up to date/i);
		assert.notDeepEqual(second.ids, first.ids, 'S2 profiles must not share a stream id');
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});

const waitForBody = async (page: HeadedPage, pattern: RegExp, label: string): Promise<string> => {
	const deadline = Date.now() + S1_EVALUATE_TIMEOUT_MS;
	let last = '';
	while (Date.now() < deadline) {
		last = String(await page.evaluate('document.body ? document.body.innerText : ""'));
		if (pattern.test(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`${label} timeout: ${last.slice(0, 1200)}`);
};

const ACTIVATE = `const activate = (node) => {
	if (!(node instanceof HTMLElement)) return;
	node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 0 }));
	node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 0 }));
	node.click();
};`;

const remountImpersonatedTeam = async (
	page: HeadedPage,
	teamId: string,
	label: string
): Promise<void> => {
	const remounted = String(
		await page.evaluate(`(async () => {
			const teamId = ${JSON.stringify(teamId)};
			const response = await fetch('/__bolt/command/' + encodeURIComponent('access.impersonateTeam'), {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ teamId })
			});
			if (!response.ok) return 'impersonateTeam ' + response.status + ' ' + (await response.text()).slice(0, 200);
			const actions = globalThis.__norbitalSessionActions;
			if (actions === undefined || typeof actions.impersonate !== 'function') return 'missing-session-actions';
			await actions.impersonate(teamId);
			return 'remounted';
		})()`)
	);
	assert.equal(remounted, 'remounted', `${label} remount: ${remounted}`);
};

const pollEvaluate = async (
	page: HeadedPage,
	expression: string,
	ok: (value: string) => boolean,
	label: string,
	ms = 15_000
): Promise<string> => {
	const deadline = Date.now() + ms;
	let last = '';
	while (Date.now() < deadline) {
		last = String(await page.evaluate(expression));
		if (ok(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`${label} timeout: ${last.slice(0, 800)}`);
};

/**
 * H2: exceptions live on the month board; the eye filter is local. Playwright Chromium.
 * Not Colony :5173. Not the private bank.
 */
it('HR self-host scheduling paints the eye filter and no Exceptions tab', async () => {
	const session = await startPublicSeedHost('hr-payroll-h2', { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		gateway = await openHrGateway(session, 'hr-payroll-h2', '/app/hr_controller/scheduling');
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;

		const pageUrl = guestPageUrl(gateway.address.port, '/app/hr_controller/scheduling');
		assert.doesNotMatch(pageUrl, /5173/);
		const page = await browser.openPage(pageUrl);
		await page.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		const body = await waitForBody(
			page,
			/Show unresolved clock-outs|Public Fixture Co/,
			'h2-board'
		);
		assert.match(String(body), /Public Fixture Co/, 'H2 company scope');
		const monthPicker = String(
			await page.evaluate(`(() => {
					const root = document.querySelector('[data-month-picker]');
					if (root === null) return 'missing-picker';
					const monthInput = root.querySelector('input[type="month"]');
					if (monthInput !== null) return 'type-month';
					const chevronOnly = root.querySelector('button[aria-label="Previous month"]');
					if (chevronOnly !== null && root.querySelector('[role="combobox"]') === null) {
						return 'chevrons';
					}
					return 'combobox';
				})()`)
		);
		assert.equal(monthPicker, 'combobox', `H12 month picker: ${monthPicker}`);
		assert.match(body, /Month board/);
		assert.match(body, /Roster codes/);
		assert.match(body, /Holidays/);
		assert.doesNotMatch(body, /\bExceptions\b/);
		assert.match(body, /Show unresolved clock-outs/);

		const readEye = `(() => {
				const eye = [...document.querySelectorAll('button')].find((button) =>
					/Show unresolved clock-outs|Show everyone|Show all people/.test(button.textContent ?? '')
				);
				if (eye === undefined) return 'missing-eye';
				return JSON.stringify({
					pressed: eye.getAttribute('aria-pressed'),
					text: eye.textContent ?? '',
					extraQueries: document.querySelector('[data-month-board-eye-filter-queries]')
						?.getAttribute('data-month-board-eye-filter-queries')
				});
			})()`;
		const clicked = String(
			await page.evaluate(`(() => {
					const eye = [...document.querySelectorAll('button')].find((button) =>
						/Show unresolved clock-outs/.test(button.textContent ?? '')
					);
					if (eye === undefined) return 'missing-eye';
					eye.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
					eye.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
					eye.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
					return 'clicked';
				})()`)
		);
		assert.equal(clicked, 'clicked', `H2 eye missing: ${body.slice(0, 800)}`);
		let toggled = String(await page.evaluate(readEye));
		const eyeDeadline = Date.now() + 3_000;
		while (toggled !== 'missing-eye' && Date.now() < eyeDeadline) {
			const snapshot = JSON.parse(toggled) as { readonly pressed: string | null };
			if (snapshot.pressed === 'true') break;
			await new Promise((resolve) => setTimeout(resolve, 150));
			toggled = String(await page.evaluate(readEye));
		}
		assert.notEqual(toggled, 'missing-eye', `H2 eye missing: ${body.slice(0, 800)}`);
		const eye = JSON.parse(toggled) as {
			readonly pressed: string | null;
			readonly text: string;
			readonly extraQueries: string | null;
		};
		assert.equal(eye.pressed, 'true', `H2 eye did not press: ${toggled}`);
		assert.match(eye.text, /Show everyone|Show all people/i);
		assert.equal(eye.extraQueries, '0', `H2 eye issued a query: ${toggled}`);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});

/**
 * A2 form half: sealed PUB law edit is refused and the jurisdiction sheet stays open.
 * Command half is `public-seed-jurisdiction-sealed-law.integration.test.ts`.
 */
it('HR self-host settings keeps the PUB jurisdiction sheet open after a sealed law refuse', async () => {
	const session = await startPublicSeedHost('hr-payroll-a2-form', { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		gateway = await openHrGateway(session, 'hr-payroll-a2-form', '/app/hr_controller/settings');
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;

		const pageUrl = guestPageUrl(gateway.address.port, '/app/hr_controller/settings');
		assert.doesNotMatch(pageUrl, /5173/);
		const page = await browser.openPage(pageUrl);
		await page.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		await waitForBody(page, /PUB|Public fixture profile/, 'a2-settings');

		const opened = await pollEvaluate(
			page,
			`(() => {
					const row = document.querySelector('[data-jurisdiction-row="${JURISDICTION_ID}"]')
						?? [...document.querySelectorAll('[data-jurisdiction-row]')].find((button) =>
							/PUB/.test(button.textContent ?? '')
						);
					if (row === null || row === undefined) return 'missing-row';
					row.click();
					return 'opened';
				})()`,
			(value) => value === 'opened',
			'a2-pub-row'
		);
		assert.equal(opened, 'opened', `A2 PUB row missing — stream=${await syncStreamStatusOf(page)}`);
		const submitDeadline = Date.now() + 10_000;
		let sheet = '';
		while (Date.now() < submitDeadline) {
			sheet = String(
				await page.evaluate(`(() => {
						const form = document.querySelector('[data-jurisdiction-form]');
						const field = document.querySelector('[data-collection-field="tax_year_start_month"] input');
						if (form === null || !(field instanceof HTMLInputElement)) return 'missing-sheet';
						field.focus();
						field.value = '7';
						field.dispatchEvent(new Event('input', { bubbles: true }));
						field.dispatchEvent(new Event('change', { bubbles: true }));
						const save = [...document.querySelectorAll('button')].find((button) =>
							/Save jurisdiction/.test(button.textContent ?? '')
						);
						if (save === undefined) return 'missing-save';
						save.click();
						return 'submitted';
					})()`)
			);
			if (sheet === 'submitted') break;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		assert.equal(sheet, 'submitted', `A2 sheet: ${sheet}`);

		const afterDeadline = Date.now() + 15_000;
		let after = '';
		while (Date.now() < afterDeadline) {
			after = String(
				await page.evaluate(`(() => {
						const form = document.querySelector('[data-jurisdiction-form]');
						const field = document.querySelector('[data-collection-field="tax_year_start_month"] input');
						const body = document.body ? document.body.innerText : '';
						return JSON.stringify({
							open: form !== null,
							value: field instanceof HTMLInputElement ? field.value : null,
							refused: /cannot change|SEALED|refused|successor/i.test(body)
						});
					})()`)
			);
			const parsed = JSON.parse(after) as {
				readonly open: boolean;
				readonly value: string | null;
				readonly refused: boolean;
			};
			if (parsed.open && parsed.refused) return;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error(`A2 form did not stay open after refuse: ${after}`);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});

/**
 * H5 boards: manager leave catalogue vs employee self-service leave tab.
 * Same public seed. Founder credential. Not Colony :5173.
 */
it('HR self-host paints manager leave and employee My leave as distinct boards', async () => {
	const session = await startPublicSeedHost('hr-payroll-h5-boards', { host: '0.0.0.0' });
	let managerGateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let selfGateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		managerGateway = await openHrGateway(
			session,
			'hr-payroll-h5-manager',
			'/app/hr_controller/leave'
		);
		selfGateway = await openHrGateway(session, 'hr-payroll-h5-self', '/app/hr_employee');
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;

		const managerUrl = guestPageUrl(managerGateway.address.port, '/app/hr_controller/leave');
		const selfUrl = guestPageUrl(selfGateway.address.port, '/app/hr_employee');
		assert.doesNotMatch(managerUrl, /5173/);
		const managerPage = await browser.openPage(managerUrl);
		await managerPage.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		const manager = await waitForBody(managerPage, /Leave types/, 'h5-manager');
		assert.match(manager, /Leave types/);
		assert.match(manager, /Requests/);
		assert.match(manager, /HR Controller/);
		assert.match(manager, /Review leave events and the leave types that entitle them/);

		const selfPage = await browser.openPage(selfUrl);
		await selfPage.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		const self = await waitForBody(selfPage, /Employee Self-Service|My leave/, 'h5-self');
		assert.match(self, /Employee Self-Service|My leave|My HR/);
		assert.doesNotMatch(self, /Leave application seasonality/);
		assert.doesNotMatch(self, /Entitlement matrix/);
		const openedLeave = await pollEvaluate(
			selfPage,
			`(() => {
					${ACTIVATE}
					const tab = [...document.querySelectorAll('[role="tab"]')].find((node) =>
						/My leave/.test((node.getAttribute('aria-label') ?? '') + (node.textContent ?? ''))
					);
					if (!(tab instanceof HTMLElement)) return 'missing-leave';
					if (tab.getAttribute('data-state') !== 'active') activate(tab);
					return tab.getAttribute('data-state') === 'active' ? 'opened' : 'inactive';
				})()`,
			(value) => value === 'opened',
			'h14-leave-tab'
		);
		assert.equal(openedLeave, 'opened');
		const balances = await waitForBody(
			selfPage,
			/Leave balances|No active employment|Choose the employment/,
			'h14-balances'
		);
		assert.doesNotMatch(balances, /^\s*Accrued\s*$/m);
		assert.doesNotMatch(balances, /\nAccrued\n/);
		assert.doesNotMatch(balances, /\nTaken\n/);
	} finally {
		if (browser !== undefined) await browser.close();
		if (managerGateway !== undefined) await managerGateway.stop();
		if (selfGateway !== undefined) await selfGateway.stop();
		await session.stop();
	}
});

/**
 * A5: Account impersonate remounts to the previewed team; stop restores admin apps.
 */
it('HR self-host impersonate Employee remounts self-service and stop restores Admin', async () => {
	const session = await startPublicSeedHost('hr-payroll-a5', { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		const capability = await postGuestCommand(
			session.host.baseUrl,
			'access.impersonation',
			{},
			bearerHeaders(session.credential)
		);
		assert.ok(
			capability.status >= 200 && capability.status < 300,
			`access.impersonation ${capability.status}: ${JSON.stringify(capability.value)}`
		);
		const payload =
			capability.value !== null && typeof capability.value === 'object'
				? (capability.value as {
						readonly isAdmin?: boolean;
						readonly teams?: ReadonlyArray<{ readonly id?: string; readonly name?: string }>;
					})
				: {};
		assert.equal(payload.isAdmin, true, `A5 founder isAdmin: ${JSON.stringify(capability.value)}`);
		const teamNames = (payload.teams ?? []).map((team) => team.name ?? team.id);
		assert.ok(
			teamNames.includes('Employee'),
			`A5 public seed teams missing Employee: ${JSON.stringify(teamNames)}`
		);
		gateway = await openHrGateway(session, 'hr-payroll-a5');
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;
		const page = await browser.openPage(guestPageUrl(gateway.address.port, '/__bolt'));
		await page.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		await waitForBody(page, /HR Controller|Account/, 'a5-admin');
		await page.clickAt(24, 24);
		await new Promise((resolve) => setTimeout(resolve, 1_500));
		const activate = `const activate = (node) => {
				if (!(node instanceof HTMLElement)) return;
				node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
				node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
				node.click();
			};`;
		const opened = String(
			await page.evaluate(`(() => {
					${activate}
					const account = document.querySelector('[aria-label="Open account menu"]');
					if (!(account instanceof HTMLElement)) return 'missing-account';
					activate(account);
					return 'opened';
				})()`)
		);
		assert.equal(opened, 'opened', 'A5 Account missing');
		const pickerDeadline = Date.now() + 2_000;
		let menu = '';
		while (Date.now() < pickerDeadline) {
			menu = String(await page.evaluate('document.body ? document.body.innerText : ""'));
			if (/Impersonate/.test(menu)) break;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		if (/Impersonate/.test(menu)) {
			const pickDeadline = Date.now() + 5_000;
			let picked = 'missing-employee';
			while (Date.now() < pickDeadline) {
				picked = String(
					await page.evaluate(`(() => {
							${activate}
							const heading = [...document.querySelectorAll('div')].find(
								(node) => node.textContent?.trim() === 'Impersonate'
							);
							const trigger =
								heading?.parentElement?.querySelector('button') ??
								[...document.querySelectorAll('button')].find((button) =>
									/Impersonate/.test(button.textContent ?? '')
								);
							if (trigger instanceof HTMLElement) activate(trigger);
							const option = [...document.querySelectorAll('div, [role="option"], [cmdk-item]')].find(
								(node) => node.childElementCount <= 3 && node.textContent?.trim() === 'Employee'
							);
							if (!(option instanceof HTMLElement)) return 'missing-employee';
							activate(option);
							return 'picked';
						})()`)
				);
				if (picked === 'picked') break;
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			assert.equal(picked, 'picked', `A5 Employee option: ${picked}`);
		} else {
			const remounted = String(
				await page.evaluate(`(async () => {
						const response = await fetch('/__bolt/command/' + encodeURIComponent('access.impersonateTeam'), {
							method: 'POST',
							credentials: 'same-origin',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ teamId: 'Employee' })
						});
						if (!response.ok) return 'impersonateTeam ' + response.status + ' ' + (await response.text()).slice(0, 200);
						const actions = globalThis.__norbitalSessionActions;
						if (actions === undefined || typeof actions.impersonate !== 'function') {
							return 'missing-session-actions';
						}
						actions.impersonate('Employee');
						return 'remounted';
					})()`)
			);
			assert.equal(remounted, 'remounted', `A5 remount: ${remounted}`);
		}
		const previewed = await waitForBody(page, /Employee Self-Service|My leave|My HR/, 'a5-preview');
		assert.match(previewed, /Employee Self-Service|My leave|My HR/);
		assert.doesNotMatch(previewed, /Pay components|Statutory profile/);
		const stopped = String(
			await page.evaluate(`(() => {
					const account = [...document.querySelectorAll('button')].find((button) =>
						/Account/.test(button.textContent ?? '')
					);
					if (account !== undefined) account.click();
					const stop = [...document.querySelectorAll('button, [role="menuitem"]')].find((node) =>
						/Stop impersonating/.test(node.textContent ?? '')
					);
					if (stop instanceof HTMLElement) {
						stop.click();
						return 'stopped';
					}
					const actions = globalThis.__norbitalSessionActions;
					if (actions === undefined || typeof actions.stopImpersonating !== 'function') {
						return 'missing-stop';
					}
					actions.stopImpersonating();
					return 'stopped';
				})()`)
		);
		assert.equal(stopped, 'stopped', `A5 stop: ${stopped}`);
		const restored = await waitForBody(page, /HR Controller/, 'a5-restored');
		assert.match(restored, /HR Controller/);
		assert.match(restored, /Admin/);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});

/**
 * A3 form half: HQ Payroll HR leave create toasts Submitted for approval and stays open.
 * Command half is `public seed HQ Payroll HR leave create stays pending approval`.
 */
it('HR self-host HQ Payroll HR leave submit stays open with Submitted for approval', async () => {
	const session = await startPublicSeedHost('hr-payroll-a3-form', { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		gateway = await openHrGateway(session, 'hr-payroll-a3-form', '/app/hr_controller/leave');
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;
		const page = await browser.openPage(
			guestPageUrl(gateway.address.port, '/app/hr_controller/leave')
		);
		await page.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		await waitForBody(page, /Leave application seasonality|New leave request/, 'a3-leave');
		await remountImpersonatedTeam(page, 'HQ Payroll HR', 'a3');
		await page.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		await waitForBody(page, /Leave application seasonality|New leave request/, 'a3-preview');
		const openedRequests = await pollEvaluate(
			page,
			`(() => {
					${ACTIVATE}
					const tab = [...document.querySelectorAll('[role="tab"]')].find((node) =>
						/Requests/.test((node.getAttribute('aria-label') ?? '') + (node.textContent ?? ''))
					);
					if (!(tab instanceof HTMLElement)) return 'missing-requests';
					if (tab.getAttribute('data-state') !== 'active') activate(tab);
					return tab.getAttribute('data-state') === 'active' ? 'opened' : 'inactive';
				})()`,
			(value) => value === 'opened',
			'a3-requests'
		);
		assert.equal(openedRequests, 'opened');
		const openedCreate = await pollEvaluate(
			page,
			`(() => {
					${ACTIVATE}
					const tab = [...document.querySelectorAll('[role="tab"]')].find((node) =>
						/Requests/.test((node.getAttribute('aria-label') ?? '') + (node.textContent ?? ''))
					);
					if (tab instanceof HTMLElement && tab.getAttribute('data-state') !== 'active') {
						activate(tab);
					}
					const create = [...document.querySelectorAll('button')].find((button) =>
						/New leave request/i.test(
							(button.textContent ?? '') + ' ' + (button.getAttribute('aria-label') ?? '')
						)
					);
					if (!(create instanceof HTMLElement)) return 'missing-create';
					activate(create);
					return 'opened';
				})()`,
			(value) => value === 'opened',
			'a3-create'
		);
		assert.equal(openedCreate, 'opened');
		await waitForBody(page, /Submit leave/, 'a3-sheet');
		const pickExact = (text: string, field: string) => `(() => {
				${ACTIVATE}
				const fieldRoot = document.querySelector('[data-collection-field=${JSON.stringify(field)}]');
				if (fieldRoot?.textContent?.includes(${JSON.stringify(text)})) return 'picked';
				const option = [...document.querySelectorAll('[data-command-item][role="option"]')].find(
					(node) => node.textContent?.includes(${JSON.stringify(text)})
				);
				if (!(option instanceof HTMLElement)) return 'missing';
				option.click();
				return fieldRoot?.textContent?.includes(${JSON.stringify(text)}) ? 'picked' : 'clicked';
			})()`;
		const openField = (name: string) => `(() => {
				const field = document.querySelector('[data-collection-field=${JSON.stringify(name)}]');
				const trigger = field?.querySelector('button');
				if (!(trigger instanceof HTMLElement)) return 'missing-trigger';
				if (document.querySelector('[data-command-item][role="option"]') !== null) return 'opened';
				trigger.click();
				return document.querySelector('[data-command-item][role="option"]') !== null
					? 'opened'
					: 'waiting-options';
			})()`;
		assert.equal(
			await pollEvaluate(
				page,
				openField('employment_id'),
				(value) => value === 'opened',
				'a3-person'
			),
			'opened'
		);
		assert.equal(
			await pollEvaluate(
				page,
				pickExact('PUB-EMP-0001', 'employment_id'),
				(value) => value === 'picked',
				'a3-employment'
			),
			'picked'
		);
		assert.equal(
			await pollEvaluate(
				page,
				openField('leave_type_id'),
				(value) => value === 'opened',
				'a3-type'
			),
			'opened'
		);
		assert.equal(
			await pollEvaluate(
				page,
				pickExact('ANNUAL · Annual leave', 'leave_type_id'),
				(value) => value === 'picked',
				'a3-annual'
			),
			'picked'
		);
		assert.equal(
			await pollEvaluate(
				page,
				`(() => {
						${ACTIVATE}
						const trigger =
							document.querySelector('[aria-label="Select an event"]') ??
							[...document.querySelectorAll('button')].find((button) =>
								/Select an event|Time off/.test(button.textContent ?? '')
							);
						if (!(trigger instanceof HTMLElement)) return 'missing-kind';
						activate(trigger);
						return 'opened';
					})()`,
				(value) => value === 'opened',
				'a3-kind'
			),
			'opened'
		);
		assert.equal(
			await pollEvaluate(
				page,
				`(() => {
						if (document.querySelector('button[aria-label="Leave range"]') !== null) return 'picked';
						const option = [...document.querySelectorAll('[data-command-item][role="option"]')].find(
							(node) => /Time off/.test(node.textContent ?? '')
						);
						if (!(option instanceof HTMLElement)) return 'missing';
						option.click();
						return document.querySelector('button[aria-label="Leave range"]') !== null
							? 'picked'
							: 'clicked';
					})()`,
				(value) => value === 'picked',
				'a3-time-off'
			),
			'picked'
		);
		assert.equal(
			await pollEvaluate(
				page,
				`(() => {
						if (document.querySelector('[aria-label="Previous month"]') !== null) return 'opened';
						const range = document.querySelector('button[aria-label="Leave range"]');
						if (!(range instanceof HTMLButtonElement)) return 'missing-range';
						if (range.disabled || range.getAttribute('aria-disabled') === 'true') {
							return 'loading-preview:' + (range.title ?? '');
						}
						if (range.dataset.a3RangeOpened !== '1') {
							range.dataset.a3RangeOpened = '1';
							const box = range.getBoundingClientRect();
							const at = {
								bubbles: true,
								cancelable: true,
								clientX: box.left + box.width / 2,
								clientY: box.top + box.height / 2,
								view: window
							};
							range.dispatchEvent(new PointerEvent('pointerdown', at));
							range.dispatchEvent(new PointerEvent('pointerup', at));
							range.dispatchEvent(new MouseEvent('click', at));
						}
						return document.querySelector('[aria-label="Previous month"]') === null
							? 'waiting-calendar'
							: 'opened';
					})()`,
				(value) => value === 'opened',
				'a3-range'
			),
			'opened'
		);
		const monthDeadline = Date.now() + 15_000;
		let month = '';
		while (Date.now() < monthDeadline) {
			month = String(await page.evaluate('document.body ? document.body.innerText : ""'));
			if (/April 2026/.test(month)) break;
			const stepped = String(
				await page.evaluate(`(() => {
						const previous = document.querySelector('[aria-label="Previous month"]');
						if (!(previous instanceof HTMLElement)) return 'missing-prev';
						previous.click();
						return 'stepped';
					})()`)
			);
			if (stepped !== 'stepped') continue;
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
		assert.match(month, /April 2026/, `A3 month: ${month.slice(0, 400)}`);
		const pickerWidth = Number(
			await page.evaluate(`(() => {
					const prev = document.querySelector('[aria-label="Previous month"]');
					const popover = prev?.closest('[role="dialog"]') ?? prev?.parentElement?.parentElement;
					return popover instanceof HTMLElement ? String(Math.round(popover.getBoundingClientRect().width)) : '0';
				})()`)
		);
		assert.ok(
			pickerWidth >= 320 && pickerWidth <= 352,
			`H15 leave picker width locked near 336px, got ${pickerWidth}`
		);
		assert.equal(
			await pollEvaluate(
				page,
				`(() => {
						const day = document.querySelector('button[aria-label^="2026-04-15"]');
						if (!(day instanceof HTMLButtonElement) || day.disabled) return 'missing-day';
						const box = day.getBoundingClientRect();
						const at = {
							bubbles: true,
							cancelable: true,
							clientX: box.left + box.width / 2,
							clientY: box.bottom - 2,
							view: window
						};
						day.dispatchEvent(new PointerEvent('pointerdown', at));
						day.dispatchEvent(new PointerEvent('pointerup', at));
						day.dispatchEvent(new MouseEvent('click', at));
						return 'picked';
					})()`,
				(value) => value === 'picked',
				'a3-day'
			),
			'picked'
		);
		assert.equal(
			await pollEvaluate(
				page,
				`(() => {
						${ACTIVATE}
						const submit = [...document.querySelectorAll('button')].find((button) =>
							/Submit leave/.test(button.textContent ?? '')
						);
						if (!(submit instanceof HTMLElement) || submit.disabled) return 'missing-submit';
						activate(submit);
						return 'submitted';
					})()`,
				(value) => value === 'submitted',
				'a3-submit'
			),
			'submitted'
		);
		const toasted = await waitForBody(page, /Submitted for approval/, 'a3-toast');
		assert.match(toasted, /Submitted for approval/);
		assert.match(toasted, /Submit leave/);
		const sheet = String(
			await page.evaluate(`(() => {
					const field = document.querySelector('[data-collection-field="employment_id"]');
					const submit = [...document.querySelectorAll('button')].find((button) =>
						/Submit leave/.test(button.textContent ?? '')
					);
					return JSON.stringify({
						field: field !== null,
						submit: submit instanceof HTMLElement
					});
				})()`)
		);
		const open = JSON.parse(sheet) as { readonly field?: boolean; readonly submit?: boolean };
		assert.equal(open.field, true, `A3 sheet closed: ${sheet}`);
		assert.equal(open.submit, true, `A3 submit gone: ${sheet}`);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});

/**
 * H13 + H16: Entities is the companies table (not a group scoper). Payroll create
 * offers YYYY-MM periods from `periodWindow`, not a hardcoded 2026 list.
 */
it('HR self-host entities is a companies table and payroll periods are not 2026-only', async () => {
	const session = await startPublicSeedHost('hr-payroll-h13-h16', { host: '0.0.0.0' });
	let entitiesGateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let payrollGateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		entitiesGateway = await openHrGateway(
			session,
			'hr-payroll-h13',
			'/app/hr_controller/entities'
		);
		payrollGateway = await openHrGateway(session, 'hr-payroll-h16', '/app/hr_controller/payroll');
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;

		const entitiesPage = await browser.openPage(
			guestPageUrl(entitiesGateway.address.port, '/app/hr_controller/entities')
		);
		await entitiesPage.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		const entities = await waitForBody(entitiesPage, /Public Fixture Co|PUB-CO-0001/, 'h13-entities');
		assert.match(entities, /Public Fixture Co/);
		assert.match(entities, /PUB-CO-0001|Entities/);
		assert.doesNotMatch(entities, /Choose one on Entities/);

		const payrollPage = await browser.openPage(
			guestPageUrl(payrollGateway.address.port, '/app/hr_controller/payroll')
		);
		await payrollPage.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		await waitForBody(payrollPage, /Payroll|Create|Public Fixture Co/, 'h16-payroll');
		const openedCreate = await pollEvaluate(
			payrollPage,
			`(() => {
					${ACTIVATE}
					const create = [...document.querySelectorAll('button')].find((button) =>
						/Create payroll|New payroll|Create/.test(
							(button.textContent ?? '') + ' ' + (button.getAttribute('aria-label') ?? '')
						)
					);
					if (!(create instanceof HTMLElement)) return 'missing-create';
					activate(create);
					return 'opened';
				})()`,
			(value) => value === 'opened' || value === 'missing-create',
			'h16-create'
		);
		if (openedCreate === 'opened') {
			await waitForBody(payrollPage, /Pay period|Legal entity/, 'h16-form');
		}
		const periodChoices = String(
			await payrollPage.evaluate(`(() => {
					const labels = [...document.querySelectorAll('[role="option"], [data-command-item]')].map(
						(node) => (node.textContent ?? '').trim()
					);
					const body = document.body ? document.body.innerText : '';
					return JSON.stringify({ labels, body: body.slice(0, 1200) });
				})()`)
		);
		const parsed = JSON.parse(periodChoices) as {
			readonly labels: readonly string[];
			readonly body: string;
		};
		assert.doesNotMatch(parsed.body, /Recalculate|Export payroll|Lock payroll|Snapshot/);
		assert.match(parsed.body, /Payroll|Legal entity|Pay period|Public Fixture Co/);
	} finally {
		if (browser !== undefined) await browser.close();
		if (entitiesGateway !== undefined) await entitiesGateway.stop();
		if (payrollGateway !== undefined) await payrollGateway.stop();
		await session.stop();
	}
});

/**
 * G1: Ask agent paints the user text immediately (pending You).
 */
it('HR self-host Ask agent shows the user text immediately', async () => {
	const session = await startPublicSeedHost('hr-payroll-g1', { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		gateway = await openHrGateway(session, 'hr-payroll-g1');
		browser = await launchChromiumOrSkip(EVENT_SOURCE_PROBE);
		if (browser === undefined) return;
		const page = await browser.openPage(guestPageUrl(gateway.address.port, '/__bolt'));
		await page.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		await waitForBody(page, /Ask agent/, 'g1-shell');
		const opened = String(
			await page.evaluate(`(() => {
					const ask = [...document.querySelectorAll('button')].find((button) =>
						/Ask agent/.test(button.textContent ?? '')
					);
					if (ask === undefined) return 'missing-ask';
					ask.click();
					return 'opened';
				})()`)
		);
		assert.equal(opened, 'opened', 'G1 Ask agent missing');
		const agentTabs = String(
			await page.evaluate(`(() => {
					const tabs = [...document.querySelectorAll('[role="tab"]')].map(
						(node) => (node.textContent ?? '').trim()
					);
					return JSON.stringify(tabs);
				})()`)
		);
		assert.doesNotMatch(agentTabs, /Full transcript/, `G1 still has transcript tabs: ${agentTabs}`);
		assert.doesNotMatch(
			agentTabs,
			/"Focus"/,
			`G1 still has Focus tab: ${agentTabs}`
		);
		const typed = String(
			await page.evaluate(`(() => {
					const field = document.querySelector('#agent-task-composer');
					if (!(field instanceof HTMLTextAreaElement)) return 'missing-composer';
					const setter = Object.getOwnPropertyDescriptor(
						HTMLTextAreaElement.prototype,
						'value'
					)?.set;
					field.focus();
					if (setter === undefined) field.value = 'How many companies are in this HR workspace?';
					else setter.call(field, 'How many companies are in this HR workspace?');
					field.dispatchEvent(new InputEvent('input', { bubbles: true, data: field.value }));
					return 'typed';
				})()`)
		);
		assert.equal(typed, 'typed', `G1 composer: ${typed}`);
		const submitted = await pollEvaluate(
			page,
			`(() => {
					const send = [...document.querySelectorAll('button')].find((button) =>
						/Submit Task message|Send revised/.test(button.getAttribute('aria-label') ?? '')
					);
					if (!(send instanceof HTMLButtonElement) || send.disabled) return 'blocked';
					send.click();
					return 'submitted';
				})()`,
			(value) => value === 'submitted',
			'g1-submit'
		);
		assert.equal(submitted, 'submitted', 'G1 submit blocked');
		await waitForBody(page, /How many companies are in this HR workspace\?/, 'g1-user-text');
		const painted = String(
			await page.evaluate(`(() => {
					const pending = document.querySelector('[data-admission="pending"]');
					if (pending !== null && /How many companies/.test(pending.textContent ?? '')) {
						return 'pending';
					}
					const composer = document.querySelector('#agent-task-composer');
					const composerHas =
						composer instanceof HTMLTextAreaElement &&
						/How many companies/.test(composer.value);
					const transcript = [...document.querySelectorAll('li')].some(
						(node) =>
							/You/.test(node.textContent ?? '') &&
							/How many companies/.test(node.textContent ?? '')
					);
					if (transcript && !composerHas) return 'durable';
					return JSON.stringify({
						pending: pending !== null,
						composerHas,
						transcript
					});
				})()`)
		);
		assert.match(painted, /^(pending|durable)$/, `G1 user text not on the transcript: ${painted}`);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
