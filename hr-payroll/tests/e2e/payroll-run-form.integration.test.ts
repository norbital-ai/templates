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

const ACTIVATE = `const activate = (node) => {
	if (!(node instanceof HTMLElement)) return;
	node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 0 }));
	node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 0 }));
	node.click();
};
const buttonMatching = (pattern) =>
	[...document.querySelectorAll('button')].find((button) =>
		pattern.test(((button.textContent ?? '') + ' ' + (button.getAttribute('aria-label') ?? '')).trim())
	);`;

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
	throw new Error(`${label} timeout: ${last.slice(0, 1200)}`);
};

/** Opens a combobox by its accessible name, filters it, and activates the first matching option. */
const chooseOption = async (page: HeadedPage, name: string, filter: string, label: string) => {
	assert.equal(
		await waitFor(
			page,
			`(() => {
				${ACTIVATE}
				const trigger = [...document.querySelectorAll('[role="combobox"]')].find(
					(node) => (node.getAttribute('aria-label') ?? '') === ${JSON.stringify(name)}
				);
				if (!(trigger instanceof HTMLElement))
					return 'missing-trigger:' + JSON.stringify([...document.querySelectorAll('[role="combobox"]')].map((node) => node.getAttribute('aria-label')));
				if (trigger.getAttribute('aria-expanded') !== 'true') activate(trigger);
				return 'opened';
			})()`,
			(value) => value === 'opened',
			`${label}-open`
		),
		'opened'
	);
	assert.equal(
		await waitFor(
			page,
			`(() => {
				${ACTIVATE}
				const search = document.querySelector('[role="listbox"] input[type="text"], [cmdk-input], input[placeholder^="Search"]');
				if (search instanceof HTMLInputElement) {
					const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
					setter?.call(search, ${JSON.stringify(filter)});
					search.dispatchEvent(new Event('input', { bubbles: true }));
				}
				const option = [...document.querySelectorAll('[role="option"]')].find((node) =>
					(node.textContent ?? '').includes(${JSON.stringify(filter)})
				);
				if (!(option instanceof HTMLElement))
					return (
						'missing-option:' +
						JSON.stringify({
							trigger: [...document.querySelectorAll('[role="combobox"]')].map((node) => ({
								label: node.getAttribute('aria-label'),
								expanded: node.getAttribute('aria-expanded'),
								disabled: node.hasAttribute('disabled')
							})),
							listbox: document.querySelector('[role="listbox"]') !== null,
							sync: (window.__syncLog ?? []).slice(-3),
							body: (document.body.innerText ?? '').slice(0, 300),
							search: search instanceof HTMLInputElement ? search.value : null,
							options: [...document.querySelectorAll('[role="option"]')]
								.slice(0, 12)
								.map((node) => (node.textContent ?? '').trim())
						})
					);
				// A plain click: synthetic pointer events on a portalled option read as an outside
				// interaction to the sheet and close it.
				option.click();
				return 'chosen';
			})()`,
			(value) => value === 'chosen',
			`${label}-choose`
		),
		'chosen'
	);
};

/**
 * Opens the month grid picker by its accessible name, walks the year navigation to the target
 * year, and activates the month cell. The payroll period is a MonthPicker, not a searchable
 * combobox, so there is no filter input and no `[role="option"]` to choose from.
 */
const chooseMonth = async (page: HeadedPage, name: string, month: string, label: string) => {
	assert.equal(
		await waitFor(
			page,
			`(() => {
				${ACTIVATE}
				const trigger = [...document.querySelectorAll('button')].find(
					(node) => (node.getAttribute('aria-label') ?? '') === ${JSON.stringify(name)}
				);
				if (!(trigger instanceof HTMLElement)) return 'missing-trigger';
				const cell = document.querySelector(${JSON.stringify(`[data-month="${month}"]`)});
				if (cell === null) {
					if (document.querySelector('[data-month-grid]') === null) activate(trigger);
					const year = Number(
						(document.querySelector('[data-month-picker-year]')?.textContent ?? '').trim()
					);
					const target = Number(${JSON.stringify(month.slice(0, 4))});
					if (Number.isFinite(year) && Number.isFinite(target) && year !== target) {
						const nav = [...document.querySelectorAll('button')].find(
							(node) =>
								(node.getAttribute('aria-label') ?? '') ===
								(target < year ? 'Previous year' : 'Next year')
						);
						if (nav instanceof HTMLElement) activate(nav);
					}
					return 'opening';
				}
				if (!(cell instanceof HTMLElement)) return 'missing-cell';
				if (cell.hasAttribute('disabled')) return 'disabled-cell';
				cell.click();
				return 'chosen';
			})()`,
			(value) => value === 'chosen',
			`${label}-choose`
		),
		'chosen'
	);
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
		browser = await launchChromiumOrSkip();
		if (browser === undefined) return;
		const page = await browser.openPage(
			guestUrlForChromium('127.0.0.1', gateway.address.port, '/app/hr_controller/payroll')
		);
		await page.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		// Record every sync control exchange so a stalled live query can be read off the failure.
		await page.evaluate(`(() => {
			window.__syncLog = [];
			const original = window.fetch.bind(window);
			window.fetch = async (input, init) => {
				const response = await original(input, init);
				const url = typeof input === 'string' ? input : input.url;
				if (/\/sync\/(connect|extend)/.test(url)) {
					const body = await response.clone().text();
					window.__syncLog.push({ url, status: response.status, request: String(init?.body ?? '').slice(0, 400), response: body.slice(0, 600) });
				}
				return response;
			};
		})()`);
		await waitFor(
			page,
			'document.body.innerText',
			(text) => /Payroll cycles/.test(text),
			'payroll-app'
		);
		assert.equal(
			await waitFor(
				page,
				`(() => { ${ACTIVATE} const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => /Payroll runs/.test(node.textContent ?? '')); if (!(tab instanceof HTMLElement)) return 'missing-tab'; activate(tab); return 'tab'; })()`,
				(value) => value === 'tab',
				'runs-tab'
			),
			'tab'
		);
		assert.equal(
			await waitFor(
				page,
				`(() => { ${ACTIVATE} const create = buttonMatching(/New Payroll Run/); if (!(create instanceof HTMLElement)) return 'missing-create'; activate(create); return 'opened'; })()`,
				(value) => value === 'opened',
				'run-create'
			),
			'opened'
		);
		await chooseOption(page, 'Legal entity', 'Public Fixture Co', 'entity');
		await waitFor(
			page,
			`(() => [...document.querySelectorAll('[role="combobox"]')].map((node) => (node.getAttribute('aria-label') ?? '') + '=' + (node.textContent ?? '').trim()).join('|'))()`,
			(value) => value.includes('Legal entity=Public Fixture Co'),
			'entity-chosen'
		);
		await chooseMonth(page, 'Pay period', '2026-02', 'period');
		await waitFor(
			page,
			'document.body.innerText',
			(text) => /Salary month/.test(text),
			'period-preview'
		);
		assert.equal(
			await waitFor(
				page,
				`(() => { ${ACTIVATE} const submit = buttonMatching(/^Create payroll run$/); if (!(submit instanceof HTMLElement)) return 'missing-submit'; activate(submit); return 'clicked'; })()`,
				(value) => value === 'clicked',
				'run-submit'
			),
			'clicked'
		);
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
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
