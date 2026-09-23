import { it } from 'vitest';
import assert from 'node:assert/strict';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import {
	guestUrlForChromium,
	launchChromiumOrSkip,
	type HeadedBrowser,
	type HeadedPage
} from '@norbital-ai/test-utilities';
import { startPublicSeedHost } from '../helpers/public-seed-host.ts';

const EVALUATE_TIMEOUT_MS = 45_000;

const isBoltDocument = (pathname: string): boolean =>
	pathname === '/__bolt' ||
	pathname === '/__bolt/' ||
	pathname === '/' ||
	pathname.startsWith('/app/');

const rewriteBoltBrowserPath = (pathname: string): string => {
	if (pathname.startsWith('/__bolt/sync/'))
		return `/sync/${pathname.slice('/__bolt/sync/'.length)}`;
	if (pathname.startsWith('/__bolt/command/'))
		return `/_bolt/command/${pathname.slice('/__bolt/command/'.length)}`;
	return pathname;
};

const waitFor = async (
	page: HeadedPage,
	expression: string,
	ok: (value: string) => boolean,
	label: string,
	ms = EVALUATE_TIMEOUT_MS
): Promise<string> => {
	const deadline = Date.now() + ms;
	let last = '';
	while (Date.now() < deadline) {
		last = String(await page.evaluate(expression));
		if (ok(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	const pageText = String(await page.evaluate('document.body.innerText'));
	throw new Error(`${label} timeout: ${last.slice(0, 1200)}\n${pageText.slice(-4000)}`);
};

/**
 * A refused create is not a create. The server answers `collections.write` with a rejected
 * settlement; the sheet must stay open with the refusal sentence in its footer, not close on the
 * operator and leave neither a run nor a reason. No period is chosen, so the declared create
 * input refuses deterministically.
 */
it('HR payroll run form keeps the sheet open and shows the refusal when the create is refused', async () => {
	const session = await startPublicSeedHost('hr-payroll-run-refusal', { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		gateway = await startSessionGateway({
			upstream: session.host.address,
			credential: session.credential,
			cookieName: 'norbital_headed',
			listen: { host: '0.0.0.0' },
			isDocument: isBoltDocument,
			rewritePath: rewriteBoltBrowserPath,
			document: ({ browserSession }) =>
				workspaceDocumentHtml({
					tenantId: 'hr-payroll-run-refusal',
					workspaceId: 'hr-payroll-run-refusal',
					environment: 'test',
					releaseId: 'hr-payroll-run-refusal',
					principal: 'hr-payroll-run-refusal-founder',
					email: 'hr-payroll-run-refusal-founder@example.test',
					syncPrincipal: 'hr-payroll-run-refusal-founder',
					organizationName: 'HR payroll public seed',
					commandPrefix: '/__bolt/command/',
					syncStreamUrl: `/__bolt/sync/stream?norbital_headed=${browserSession}`,
					viewPath: '/app/hr_controller/payroll',
					accessScope: 'operator',
					credential: session.credential
				})
		});
		browser = await launchChromiumOrSkip(`(() => {
			window.__payrollErrors = [];
			window.addEventListener('error', (event) => window.__payrollErrors.push(event.error?.stack ?? event.message));
			window.addEventListener('unhandledrejection', (event) => window.__payrollErrors.push(String(event.reason)));
		})()`);
		if (browser === undefined) return;
		const page = await browser.openPage(
			guestUrlForChromium('127.0.0.1', gateway.address.port, '/app/hr_controller/payroll')
		);
		await waitFor(
			page,
			'document.body.innerText',
			(text) => /Payroll cycles/.test(text),
			'payroll-app'
		);
		await page.click('[role="tab"]:has-text("Payroll runs")');
		await page.click('button:has-text("New Payroll Run")');
		await waitFor(
			page,
			`document.querySelector('[role="dialog"]')?.innerText ?? ''`,
			(text) => text.includes('Legal entity') && text.includes('Public Fixture Co'),
			'sheet-open'
		);
		await page.click('[role="dialog"] button:text-is("Create payroll run")');
		const alert = await waitFor(
			page,
			`document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.trim() ?? (document.querySelector('[role="dialog"]') ? '' : 'closed')`,
			(text) => text !== '',
			'refusal-shown',
			30_000
		);
		assert.notEqual(alert, 'closed', 'the sheet closed on a refused create');
		assert.match(alert, /period/i);
		// Still open a beat later: the refusal's settlement frame must not remount the page under it.
		await new Promise((resolve) => setTimeout(resolve, 2_000));
		assert.equal(
			await page.evaluate(
				`String(document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.trim() ?? 'closed')`
			),
			alert
		);
		assert.equal(await page.evaluate('JSON.stringify(window.__payrollErrors)'), '[]');
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
