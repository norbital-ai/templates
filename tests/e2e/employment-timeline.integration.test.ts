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
import {
	ERROR_RECORDER,
	assertNoErrors,
	navigate,
	readErrors,
	recordStackSearch,
	unlockDeferredQueries,
	waitForShell
} from '../helpers/surface-walk.ts';

const LABEL = 'hr-payroll-employment-timeline';
const PEOPLE = '/app/hr_controller/people';
/** The public seed's first employee: one open engagement at Public Fixture Co since 2021-06-01. */
const EMPLOYEE = '33333333-3333-4333-8333-333333333333';
const ACTIVATE = `const activate = (node) => {
	if (!(node instanceof HTMLElement)) return;
	node.scrollIntoView({ block: 'center' });
	node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	node.click();
};`;

const until = async <T>(
	read: () => Promise<T>,
	ready: (value: T) => boolean,
	label: string
): Promise<T> => {
	const deadline = Date.now() + 20_000;
	let last: T;
	do {
		last = await read();
		if (ready(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 150));
	} while (Date.now() < deadline);
	throw new Error(`${label} did not settle: ${JSON.stringify(last)}`);
};

const clickNamed = (page: HeadedPage, selector: string, label: string) =>
	until(
		() =>
			page.evaluate(
				`(() => {
			${ACTIVATE}
			const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) =>
				candidate.textContent?.trim() === ${JSON.stringify(label)} && candidate.getBoundingClientRect().height > 0
			);
			if (!(node instanceof HTMLElement)) return false;
			activate(node);
			return true;
		})()`
			),
		(value) => value === true,
		`click ${label}`
	);

/**
 * The timeline is the profile's answer to "which entity, and when" — a person's whole engagement
 * history at a glance. It reads employments the record sheet's table does not: an empty column set
 * is the shape a broken read takes, and nothing else on the page notices.
 */
it('the employee profile draws a vertical event rail per legal entity', async () => {
	const session = await startPublicSeedHost(LABEL, { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		gateway = await startSessionGateway({
			upstream: session.host.address,
			credential: session.credential,
			cookieName: 'norbital_headed',
			listen: { host: '0.0.0.0' },
			isDocument: (path) =>
				path === '/' || path === '/__bolt' || path === '/__bolt/' || path.startsWith('/app/'),
			rewritePath: (path) =>
				path.startsWith('/__bolt/sync/')
					? `/sync/${path.slice('/__bolt/sync/'.length)}`
					: path.startsWith('/__bolt/command/')
						? `/_bolt/command/${path.slice('/__bolt/command/'.length)}`
						: path,
			document: ({ browserSession }) =>
				workspaceDocumentHtml({
					tenantId: LABEL,
					workspaceId: LABEL,
					environment: 'test',
					releaseId: LABEL,
					principal: `${LABEL}-founder`,
					syncPrincipal: `${LABEL}-founder`,
					organizationName: 'Employment timeline fixture',
					commandPrefix: '/__bolt/command/',
					syncStreamUrl: `/__bolt/sync/stream?norbital_headed=${browserSession}`,
					viewPath: PEOPLE,
					accessScope: 'operator',
					credential: session.credential
				})
		});
		browser = await launchChromiumOrSkip(ERROR_RECORDER);
		assert.ok(browser, 'Chromium is required; the timeline must not pass without rendering');
		const page = await browser.openPage(
			guestUrlForChromium('127.0.0.1', gateway.address.port, PEOPLE)
		);
		await page.setViewportSize({ width: 1280, height: 900 });
		await waitForShell(page, 45_000);
		await unlockDeferredQueries(page);

		await navigate(page, `${PEOPLE}${recordStackSearch('employees', EMPLOYEE)}`);
		await until(
			() => page.evaluate(`document.querySelector('[role="dialog"]') != null`),
			(value) => value === true,
			'employee record sheet'
		);
		await clickNamed(page, '[role="tab"]', 'Employment contracts');

		const timeline = await until(
			() =>
				page.evaluate(`(() => {
					const dialog = [...document.querySelectorAll('[role="dialog"]')].at(-1);
					if (dialog == null) return { columns: 0, events: [], text: '' };
					const heading = [...dialog.querySelectorAll('h3')].find(
						(node) => node.textContent?.trim() === 'Employment timeline'
					);
					if (heading == null) return { columns: 0, events: [], text: '' };
					const section = heading.closest('section') ?? dialog;
					return {
						columns: [...section.querySelectorAll('h4')].map((node) => node.textContent?.trim()),
						events: [...section.querySelectorAll('ol li')].map((node) =>
							(node.textContent ?? '').replace(/\\s+/g, ' ').trim()
						),
						text: (section.textContent ?? '').replace(/\\s+/g, ' ').trim()
					};
				})()`),
			(value) =>
				Array.isArray((value as { columns?: unknown }).columns) &&
				(value as { columns: unknown[] }).columns.length > 0,
			'employment timeline columns'
		);
		const columns = (timeline as { columns: string[] }).columns;
		const events = (timeline as { events: string[] }).events;
		const text = (timeline as { text: string }).text;
		assert.deepEqual(columns, ['Public Fixture Co'], 'one rail per legal entity');
		assert.ok(
			events.some((event) => event.includes('Joined') && event.includes('PUB-EMP-0001')),
			`the engagement opens with its hire event: ${JSON.stringify(events)}`
		);
		assert.match(text, /Active/, 'an open engagement reads as active');
		assertNoErrors(await readErrors(page), 'employment timeline', 0);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
