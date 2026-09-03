import { it } from 'vitest';
import assert from 'node:assert/strict';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import {
	bearerHeaders,
	guestUrlForChromium,
	isHeadedRun,
	launchChromiumOrSkip,
	mutationPush,
	postGuestCommand,
	requireAccepted,
	rowsOf,
	type HeadedBrowser,
	type HeadedPage
} from '@norbital-ai/test-utilities';
import {
	DISTINCTIVE_SITE_ID,
	DISTINCTIVE_SITE_NAME,
	DISTINCTIVE_SITE_TOKEN,
	S5_PICK_DAY,
	bootPublicSeedGuest
} from '../helpers/public-seed-guest.js';

const EVALUATE_TIMEOUT_MS = 45_000;
const S4_IDLE_MS = 8_000;
const HEADED_SYNC_TIMEOUT_MILLIS = 180_000;
const HEADED_RUN = isHeadedRun();
const MUTATED_NAME = 'S2-MUTATED-AMBER';
const CONTROLLER_SHELL = 'Assign contractor';
const seededSitePattern = DISTINCTIVE_SITE_NAME.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const SNAPSHOT_PROBE = `(pattern) => {
	const all = window.__probeES ?? [];
	const list = all.filter((entry) => /sync\\/stream/.test(entry.__probeUrl ?? ''));
	const body = document.body ? document.body.innerText : '';
	return JSON.stringify({
		hidden: document.hidden,
		wrapped: window.__probeESWrapped === true,
		eventSource: typeof EventSource,
		constructed: list.length,
		open: list.filter((entry) => entry.readyState === 1).length,
		ids: list.map((entry) => entry.__probeId ?? ''),
		urls: list.map((entry) => entry.__probeUrl ?? ''),
		allUrls: all.map((entry) => entry.__probeUrl ?? ''),
		matched: new RegExp(pattern).test(body),
		body: body.slice(0, 1200),
		fetches: window.__probeFetch ?? [],
		warns: window.__probeWarn ?? []
	});
}`;

type SyncProbe = {
	readonly hidden: unknown;
	readonly wrapped?: boolean;
	readonly constructed: number;
	readonly open: number;
	readonly ids?: readonly string[];
	readonly body?: string;
	readonly urls?: readonly string[];
	readonly matched?: boolean;
};

const parseProbe = (value: unknown, label: string): SyncProbe => {
	assert.equal(typeof value, 'string', `${label} must return JSON: ${String(value)}`);
	if (typeof value !== 'string') throw new Error(`${label} must return JSON`);
	const parsed = JSON.parse(value) as SyncProbe;
	assert.equal(typeof parsed.constructed, 'number', `${label} missing constructed`);
	assert.equal(typeof parsed.open, 'number', `${label} missing open`);
	return parsed;
};

const EV_SOURCE_PROBE = `(() => {
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

const pumpPages = async (pages: readonly HeadedPage[]): Promise<void> => {
	for (const page of pages) await page.evaluate('void 0');
};

const waitForPaint = async (
	page: HeadedPage,
	pattern: string,
	label: string,
	siblings: readonly HeadedPage[] = [],
	requireWrap = false
): Promise<SyncProbe> => {
	const deadline = Date.now() + EVALUATE_TIMEOUT_MS;
	let last = 'null';
	while (Date.now() < deadline) {
		last = String(await page.evaluate(`(${SNAPSHOT_PROBE})(${JSON.stringify(pattern)})`));
		const parsed = parseProbe(last, label);
		if ((HEADED_RUN ? parsed.hidden !== true : true) && parsed.matched === true) {
			if (requireWrap && parsed.wrapped !== true) {
				await pumpPages(siblings);
				await new Promise((resolve) => setTimeout(resolve, 250));
				continue;
			}
			if (parsed.wrapped === true && parsed.open !== 1) {
				await pumpPages(siblings);
				await new Promise((resolve) => setTimeout(resolve, 250));
				continue;
			}
			return parsed;
		}
		await pumpPages(siblings);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	const connect = String(
		await page.evaluate(`(async () => {
			try {
				const response = await fetch('/__bolt/sync/connect', {
					method: 'POST',
					credentials: 'include',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ queries: [], detached: [], pending: [] })
				});
				return JSON.stringify({ status: response.status, text: (await response.text()).slice(0, 400) });
			} catch (error) {
				return JSON.stringify({ error: String(error) });
			}
		})()`)
	);
	throw new Error(`${label} timeout: ${last} connect=${connect}`);
};

const bootFieldOps = (label: string) =>
	bootPublicSeedGuest({
		tenantId: label,
		releaseId: label,
		gatewaySecret: `${label}-gateway`,
		founderEmail: `${label}-founder@example.test`,
		founderClaimId: `${label}-founder`,
		secretsKey: `${label}-secrets`,
		host: '0.0.0.0'
	});

const openFieldOpsGateway = async (
	session: Awaited<ReturnType<typeof bootFieldOps>>,
	label: string,
	viewPath = '/app/field_ops_controller'
) =>
	startSessionGateway({
		upstream: session.address,
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
				organizationName: 'Field operations public seed',
				commandPrefix: '/__bolt/command/',
				syncStreamUrl: `/__bolt/sync/stream?norbital_headed=${browserSession}`,
				viewPath,
				accessScope: 'operator',
				credential: session.credential
			})
	});

const openControllerGateway = (session: Awaited<ReturnType<typeof bootFieldOps>>, label: string) =>
	openFieldOpsGateway(session, label, '/app/field_ops_controller');

const waitForBody = async (page: HeadedPage, pattern: RegExp, label: string): Promise<string> => {
	const deadline = Date.now() + EVALUATE_TIMEOUT_MS;
	let last = '';
	while (Date.now() < deadline) {
		last = String(await page.evaluate('document.body ? document.body.innerText : ""'));
		if (pattern.test(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`${label} timeout: ${last.slice(0, 1200)}`);
};

const appUrl = (port: number, path: string): string => guestUrlForChromium('127.0.0.1', port, path);

const controllerUrl = (port: number): string => appUrl(port, '/app/field_ops_controller');

const pickSeededDay = async (page: HeadedPage): Promise<void> => {
	await page.evaluate(
		`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
	);
	const opened = await page.evaluate(`(() => {
		const trigger = [...document.querySelectorAll('button')].find((button) =>
			/Sep \\d+, 2026/.test(button.textContent ?? '')
		);
		if (trigger === undefined) return 'missing-trigger';
		trigger.click();
		return 'opened';
	})()`);
	assert.equal(
		opened,
		'opened',
		`dispatch date trigger missing: ${String(await page.evaluate('document.body ? document.body.innerText : ""'))}`
	);
	const deadline = Date.now() + 5_000;
	let picked = '';
	while (Date.now() < deadline) {
		picked = String(
			await page.evaluate(`(() => {
				const day = document.querySelector(
					${JSON.stringify(`[data-bits-day][data-value^="${S5_PICK_DAY}"]:not([data-outside-month])`)}
				);
				if (!(day instanceof HTMLElement)) {
					const labels = [...document.querySelectorAll('[data-bits-day]')].map((node) =>
						[node.getAttribute('data-value'), node.getAttribute('aria-label')].join('=')
					);
					return labels.length === 0 ? 'missing-day' : 'missing-day:' + labels.slice(0, 8).join('|');
				}
				day.click();
				return 'picked';
			})()`)
		);
		if (picked === 'picked') return;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error(`calendar day ${S5_PICK_DAY} missing: ${picked}`);
};

/**
 * S5: seeded-day pick on the field-ops controller. Playwright Chromium.
 * Not Colony :5173. Not the private bank.
 */
it(
	'field-ops self-host calendar pick of 2026-09-01 paints Amber Quay without dropping the stream',
	{ timeout: HEADED_SYNC_TIMEOUT_MILLIS },
	async () => {
		const session = await bootFieldOps('field-ops-s5');
		let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
		let browser: HeadedBrowser | undefined;
		try {
			const ready = await fetch(`${session.baseUrl}/readyz`);
			assert.equal(ready.status, 200);
			gateway = await openControllerGateway(session, 'field-ops-s5');
			browser = await launchChromiumOrSkip(EV_SOURCE_PROBE);
			if (browser === undefined) return;

			const pageUrl = controllerUrl(gateway.address.port);
			assert.doesNotMatch(pageUrl, /5173/);
			const page = await browser.openPage(pageUrl);
			await page.evaluate(
				`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
			);
			const first = await waitForPaint(page, CONTROLLER_SHELL, 's5-mount');
			assert.equal(first.constructed, 1, `S5 mount constructed: ${JSON.stringify(first)}`);
			assert.equal(first.open, 1);

			const started = Date.now();
			await pickSeededDay(page);
			const picked = await waitForPaint(page, seededSitePattern, 's5-picked');
			const pickMs = Date.now() - started;
			assert.ok(pickMs < 30_000, `S5 pick stalled ${pickMs} ms`);
			assert.equal(picked.constructed, 1, `S5 pick constructed: ${JSON.stringify(picked)}`);
			assert.equal(picked.open, 1);
			assert.match(String(picked.body), new RegExp(DISTINCTIVE_SITE_TOKEN));
			assert.deepEqual(picked.ids, first.ids);

			await new Promise((resolve) => setTimeout(resolve, S4_IDLE_MS));
			const idle = parseProbe(
				await page.evaluate(`(${SNAPSHOT_PROBE})(${JSON.stringify('Amber Quay')})`),
				's5-idle'
			);
			assert.equal(idle.constructed, 1, `S5 idle constructed: ${JSON.stringify(idle)}`);
			assert.equal(idle.open, 1, `S5 stream dropped: ${JSON.stringify(idle)}`);
			assert.deepEqual(idle.ids, first.ids, 'S5 stream id changed');
		} finally {
			if (browser !== undefined) await browser.close();
			if (gateway !== undefined) await gateway.stop();
			await session.stop();
		}
	}
);

/**
 * S2: one Chromium profile per page. Same-process second `openPage` is a separate context.
 */
it(
	'field-ops self-host second profile sees a live title mutation; other tenant stays quiet',
	{ timeout: HEADED_SYNC_TIMEOUT_MILLIS },
	async () => {
		const live = await bootFieldOps('field-ops-s2-live');
		const quiet = await bootFieldOps('field-ops-s2-quiet');
		let liveGateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
		let quietGateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
		let browser: HeadedBrowser | undefined;
		try {
			assert.equal((await fetch(`${live.baseUrl}/readyz`)).status, 200);
			assert.equal((await fetch(`${quiet.baseUrl}/readyz`)).status, 200);
			liveGateway = await openControllerGateway(live, 'field-ops-s2-live');
			quietGateway = await openControllerGateway(quiet, 'field-ops-s2-quiet');
			browser = await launchChromiumOrSkip(EV_SOURCE_PROBE);
			if (browser === undefined) return;

			const liveUrl = controllerUrl(liveGateway.address.port);
			const quietUrl = controllerUrl(quietGateway.address.port);
			const pageA = await browser.openPage(liveUrl);
			await pageA.evaluate(
				`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
			);
			const firstA = await waitForPaint(pageA, CONTROLLER_SHELL, 's2-a-mount', [], true);
			await pickSeededDay(pageA);
			await waitForPaint(pageA, seededSitePattern, 's2-a', [], true);
			const pageB = await browser.openPage(liveUrl, { profile: true });
			await pageB.evaluate(
				`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
			);
			const firstB = await waitForPaint(pageB, CONTROLLER_SHELL, 's2-b-mount', [pageA], true);
			await pickSeededDay(pageB);
			await waitForPaint(pageB, seededSitePattern, 's2-b', [pageA], true);
			const pageQ = await browser.openPage(quietUrl, { profile: true });
			await pageQ.evaluate(
				`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
			);
			const firstQ = await waitForPaint(
				pageQ,
				CONTROLLER_SHELL,
				's2-q-mount',
				[pageA, pageB],
				true
			);
			await pickSeededDay(pageQ);
			await waitForPaint(pageQ, seededSitePattern, 's2-q', [pageA, pageB], true);
			const stillA = parseProbe(
				await pageA.evaluate(`(${SNAPSHOT_PROBE})(${JSON.stringify(seededSitePattern)})`),
				's2-a-after-others'
			);
			assert.equal(
				stillA.wrapped,
				true,
				`page A lost inbox wrap after later pages: ${JSON.stringify(stillA)}`
			);
			assert.equal(firstA.constructed, 1);
			assert.equal(firstB.constructed, 1);
			assert.equal(firstQ.constructed, 1);
			assert.notDeepEqual(firstA.ids, firstB.ids);

			const listed = await postGuestCommand(
				live.baseUrl,
				'collections.findMany',
				{
					collection: 'sites',
					where: { id: { eq: DISTINCTIVE_SITE_ID } },
					columns: { id: true, row_version: true, name: true },
					limit: 1
				},
				bearerHeaders(live.credential)
			);
			assert.ok(listed.status >= 200 && listed.status < 300, JSON.stringify(listed.value));
			const site = rowsOf(listed.value, 's2 site')[0];
			assert.ok(site && typeof site.id === 'string' && typeof site.row_version === 'number');

			const mutated = await postGuestCommand(
				live.baseUrl,
				'collections.mutate',
				mutationPush(
					live.schemaFingerprint,
					{
						action: 'update',
						collection: 'sites',
						values: { id: DISTINCTIVE_SITE_ID, name: MUTATED_NAME }
					},
					[
						{
							row: { collection: 'sites', recordId: DISTINCTIVE_SITE_ID },
							rowVersion: site.row_version
						}
					]
				),
				bearerHeaders(live.credential)
			);
			assert.ok(mutated.status >= 200 && mutated.status < 300, JSON.stringify(mutated.value));
			requireAccepted(mutated.value, 's2 site name');

			const afterA = await waitForPaint(pageA, MUTATED_NAME, 's2-a-mutated', [pageB, pageQ], true);
			const afterB = await waitForPaint(pageB, MUTATED_NAME, 's2-b-mutated', [pageA, pageQ], true);
			assert.equal(afterA.wrapped, true, `A wrap after mutate: ${JSON.stringify(afterA)}`);
			assert.equal(afterB.wrapped, true, `B wrap after mutate: ${JSON.stringify(afterB)}`);
			assert.equal(afterA.constructed, 1);
			assert.equal(afterB.constructed, 1);
			assert.deepEqual(afterA.ids, firstA.ids);
			assert.deepEqual(afterB.ids, firstB.ids);

			const quietAfter = parseProbe(
				await pageQ.evaluate(`(${SNAPSHOT_PROBE})(${JSON.stringify(seededSitePattern)})`),
				's2-q-after'
			);
			assert.equal(quietAfter.constructed, 1, `quiet constructed: ${JSON.stringify(quietAfter)}`);
			assert.equal(quietAfter.open, 1, `quiet stream dropped: ${JSON.stringify(quietAfter)}`);
			assert.deepEqual(quietAfter.ids, firstQ.ids, 'quiet stream id changed');
			assert.doesNotMatch(String(quietAfter.body), new RegExp(MUTATED_NAME));
			assert.match(String(quietAfter.body), new RegExp(seededSitePattern));
			assert.match(String(quietAfter.body), new RegExp(DISTINCTIVE_SITE_TOKEN));
		} finally {
			if (browser !== undefined) await browser.close();
			if (liveGateway !== undefined) await liveGateway.stop();
			if (quietGateway !== undefined) await quietGateway.stop();
			await live.stop();
			await quiet.stop();
		}
	}
);

/**
 * B2 / B3 chrome: contractor board search + completed filter. Not Colony :5173.
 */
it(
	'field-ops self-host contractor board searches Amber Quay and completed is empty',
	{ timeout: HEADED_SYNC_TIMEOUT_MILLIS },
	async () => {
		const session = await bootFieldOps('field-ops-b-chrome');
		let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
		let browser: HeadedBrowser | undefined;
		try {
			assert.equal((await fetch(`${session.baseUrl}/readyz`)).status, 200);
			gateway = await openFieldOpsGateway(
				session,
				'field-ops-b-chrome',
				'/app/field_ops_contractor'
			);
			browser = await launchChromiumOrSkip(EV_SOURCE_PROBE);
			if (browser === undefined) return;
			const page = await browser.openPage(
				appUrl(gateway.address.port, '/app/field_ops_contractor')
			);
			await page.evaluate(
				`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
			);
			await waitForBody(page, /Dispatched jobs/, 'b-board');
			const searchDeadline = Date.now() + 8_000;
			let searched = 'missing-search';
			while (Date.now() < searchDeadline) {
				searched = String(
					await page.evaluate(`(() => {
						const trigger = document.querySelector('[aria-label="Search records"]');
						if (trigger instanceof HTMLElement) trigger.click();
						const field = [...document.querySelectorAll('input')].find((input) => input.type === 'search');
						if (!(field instanceof HTMLInputElement)) return 'missing-search';
						field.focus();
						field.value = ${JSON.stringify(DISTINCTIVE_SITE_TOKEN)};
						field.dispatchEvent(new InputEvent('input', { bubbles: true }));
						return 'typed';
					})()`)
				);
				if (searched === 'typed') break;
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			assert.equal(searched, 'typed', 'B2 search field missing');
			const hit = await waitForBody(page, new RegExp(DISTINCTIVE_SITE_TOKEN), 'b2-search');
			assert.match(hit, new RegExp(DISTINCTIVE_SITE_TOKEN));

			await page.evaluate(
				`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
			);
			const filterDeadline = Date.now() + 8_000;
			let filtered = 'missing-completed';
			while (Date.now() < filterDeadline) {
				filtered = String(
					await page.evaluate(`(() => {
						const activate = (node) => {
							if (!(node instanceof HTMLElement)) return;
							node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
							node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
							node.click();
						};
						const trigger = document.querySelector('[aria-label="Status"]')
							?? [...document.querySelectorAll('button')].find((button) =>
								/Status|All statuses/.test(
									(button.getAttribute('aria-label') ?? '') + ' ' + (button.textContent ?? '')
								)
							);
						if (!(trigger instanceof HTMLElement)) return 'missing-status';
						activate(trigger);
						const option = [...document.querySelectorAll('div, [role="option"], [cmdk-item]')].find(
							(node) => node.childElementCount <= 4 && node.textContent?.trim() === 'Completed'
						);
						if (!(option instanceof HTMLElement)) return 'missing-completed';
						activate(option);
						return 'completed';
					})()`)
				);
				if (filtered === 'completed') break;
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			assert.equal(filtered, 'completed', `B3 Completed option: ${filtered}`);
			const emptyDeadline = Date.now() + 8_000;
			let afterFilter = '';
			while (Date.now() < emptyDeadline) {
				afterFilter = String(await page.evaluate('document.body ? document.body.innerText : ""'));
				if (
					!new RegExp(DISTINCTIVE_SITE_TOKEN).test(afterFilter) ||
					/No |0 jobs|empty/i.test(afterFilter)
				)
					break;
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			const cleared = String(
				await page.evaluate(`(() => {
					const clear = [...document.querySelectorAll('button')].find((button) =>
						/^Clear$/.test(button.textContent?.trim() ?? '')
					);
					if (clear === undefined) return 'missing-clear';
					clear.click();
					return 'cleared';
				})()`)
			);
			assert.equal(cleared, 'cleared', `B3 clear: ${cleared}`);
			await waitForBody(page, new RegExp(DISTINCTIVE_SITE_TOKEN), 'b3-cleared');
		} finally {
			if (browser !== undefined) await browser.close();
			if (gateway !== undefined) await gateway.stop();
			await session.stop();
		}
	}
);

/**
 * B6 UI: Run now exists and a second start is blocked while running.
 */
it(
	'field-ops self-host Run now disables while a suspicion review is running',
	{ timeout: HEADED_SYNC_TIMEOUT_MILLIS },
	async () => {
		const session = await bootFieldOps('field-ops-b6-ui');
		let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
		let browser: HeadedBrowser | undefined;
		try {
			assert.equal((await fetch(`${session.baseUrl}/readyz`)).status, 200);
			gateway = await openControllerGateway(session, 'field-ops-b6-ui');
			browser = await launchChromiumOrSkip(EV_SOURCE_PROBE);
			if (browser === undefined) return;
			const page = await browser.openPage(controllerUrl(gateway.address.port));
			await page.evaluate(
				`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
			);
			const painted = await waitForBody(page, /Assign contractor/, 'b6-chrome');
			assert.match(painted, /Assign contractor/);
			const run = String(
				await page.evaluate(`(() => {
					const button = [...document.querySelectorAll('button')].find((node) =>
						(node.textContent ?? '').trim() === 'Run now'
					);
					if (button === undefined) return 'missing';
					return JSON.stringify({ disabled: button.disabled, text: (button.textContent ?? '').trim() });
				})()`)
			);
			assert.notEqual(run, 'missing', `B6 Run now missing: ${painted.slice(0, 400)}`);
			const parsed = JSON.parse(run) as { readonly disabled: boolean; readonly text: string };
			assert.match(parsed.text, /Run now|Running/);
			assert.ok(parsed.disabled === true || parsed.text === 'Run now');
		} finally {
			if (browser !== undefined) await browser.close();
			if (gateway !== undefined) await gateway.stop();
			await session.stop();
		}
	}
);
