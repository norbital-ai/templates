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

/** Select from the form; the page's entity scope has the same accessible name. */
const chooseOption = async (page: HeadedPage, name: string, filter: string) => {
	try {
		await page.click(`[role="dialog"] [role="combobox"][aria-label="${name}"]`);
	} catch (cause) {
		throw new Error(
			`${name} picker unavailable: ${String(await page.evaluate('JSON.stringify({ body: document.body.innerText, errors: window.__payrollErrors })'))}`,
			{ cause }
		);
	}
	await page.click(`[role="option"]:has-text("${filter}")`);
};

/**
 * Opens the month grid picker by its accessible name, walks the year navigation to the target
 * year, and activates the month cell. The payroll period is a MonthPicker, not a searchable
 * combobox, so there is no filter input and no `[role="option"]` to choose from.
 */
const chooseMonth = async (page: HeadedPage, name: string, month: string, label: string) => {
	await page.click(`[role="dialog"] button[data-month-picker][aria-label="${name}"]`);
	let year = Number(
		await waitFor(
			page,
			'document.querySelector("[data-month-picker-year]")?.textContent?.trim()',
			(value) => /^\d{4}$/.test(value),
			`${label}-year`
		)
	);
	const target = Number(month.slice(0, 4));
	assert.ok(
		Math.abs(target - year) <= 5,
		'The fixture month must lie inside the payroll offer window.'
	);
	while (year !== target) {
		const next = year + (target < year ? -1 : 1);
		await page.click(`button[aria-label="${target < year ? 'Previous year' : 'Next year'}"]`);
		year = Number(
			await waitFor(
				page,
				'document.querySelector("[data-month-picker-year]")?.textContent?.trim()',
				(value) => Number(value) === next,
				`${label}-year-change`
			)
		);
	}
	await page.click(`button[data-month="${month}"]`);
};

/**
 * The payroll run form, end to end in a browser: choose the entity and the period, create, and
 * without reloading see the sheet close and the run land in the runs table — the live prefix,
 * not a refetch. This is the flow that used to leave the sheet open and the table empty until
 * the page was reloaded.
 */
it('HR payroll run form closes on create and the new draft appears in the runs table live', async () => {
	const session = await startPublicSeedHost('hr-payroll-run-form', { host: '0.0.0.0' });
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
					tenantId: 'hr-payroll-run-form',
					workspaceId: 'hr-payroll-run-form',
					environment: 'test',
					releaseId: 'hr-payroll-run-form',
					principal: 'hr-payroll-run-form-founder',
					syncPrincipal: 'hr-payroll-run-form-founder',
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
		await chooseOption(page, 'Legal entity', 'Public Fixture Co');
		await waitFor(
			page,
			`document.querySelector('[role="dialog"] [role="combobox"][aria-label="Legal entity"]')?.textContent`,
			(value) => value.includes('Public Fixture Co'),
			'entity-chosen'
		);
		await chooseMonth(page, 'Pay period', '2026-02', 'period');
		await waitFor(
			page,
			'document.body.innerText',
			(text) => /Salary month/.test(text),
			'period-preview'
		);
		await page.click('[role="dialog"] button:text-is("Create payroll run")');
		// The sheet closes on its own once the write settles…
		await waitFor(
			page,
			`(() => [...document.querySelectorAll('button')].some((button) => /^Create payroll run$/.test((button.textContent ?? '').trim())) ? 'open' : 'closed')()`,
			(value) => value === 'closed',
			'sheet-closes',
			30_000
		);
		// …and the draft is in the runs table without a reload.
		await waitFor(
			page,
			`(() => { const region = document.querySelector('[aria-label="Collection table rows"]') ?? document.body; return region.innerText; })()`,
			(text) => /2026-02/.test(text) && /Draft/i.test(text),
			'run-in-table',
			30_000
		);
		assert.equal(await page.evaluate('JSON.stringify(window.__payrollErrors)'), '[]');
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
