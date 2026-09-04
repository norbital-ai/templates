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

const ACTIVATE = `const activate = (node) => {
	if (!(node instanceof HTMLElement)) return;
	node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 0 }));
	node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 0 }));
	node.click();
};`;

const openHrGateway = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	label: string,
	viewPath: string
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

it('HR self-host loan create nests repayments and blocks an unbalanced schedule', async () => {
	const session = await startPublicSeedHost('hr-payroll-loan-form', { host: '0.0.0.0' });
	let gateway: Awaited<ReturnType<typeof startSessionGateway>> | undefined;
	let browser: HeadedBrowser | undefined;
	try {
		assert.equal((await fetch(`${session.host.baseUrl}/readyz`)).status, 200);
		gateway = await openHrGateway(session, 'hr-payroll-loan-form', '/app/hr_controller/loans');
		browser = await launchChromiumOrSkip();
		if (browser === undefined) return;

		const page = await browser.openPage(
			guestPageUrl(gateway.address.port, '/app/hr_controller/loans')
		);
		await page.evaluate(
			`document.elementFromPoint(24, 24)?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`
		);
		await waitForBody(page, /Loan agreements/, 'loan-app');
		await waitForBody(page, /New Loan/, 'loan-create-label');
		assert.equal(
			await pollEvaluate(
				page,
				`(() => {
					${ACTIVATE}
					const create = [...document.querySelectorAll('button')].find((button) =>
						/New Loan/.test(
							(button.textContent ?? '') + ' ' + (button.getAttribute('aria-label') ?? '')
						)
					);
					if (!(create instanceof HTMLElement)) {
						const labels = [...document.querySelectorAll('button')].map((button) =>
							((button.textContent ?? '') + ' ' + (button.getAttribute('aria-label') ?? '')).trim()
						);
						return 'missing-create:' + JSON.stringify(labels.slice(0, 40));
					}
					activate(create);
					return 'opened';
				})()`,
				(value) => value === 'opened',
				'loan-create'
			),
			'opened'
		);
		const schedule = await pollEvaluate(
			page,
			`(() => {
				const root = document.querySelector('[data-loan-schedule]');
				if (!(root instanceof HTMLElement)) return 'missing-schedule';
				return JSON.stringify({
					invalid: root.getAttribute('data-invalid'),
					body: root.innerText
				});
			})()`,
			(value) => value.startsWith('{'),
			'loan-schedule'
		);
		const painted = JSON.parse(schedule) as {
			readonly invalid: string | null;
			readonly body: string;
		};
		assert.equal(painted.invalid, 'true', `schedule not flagged: ${schedule}`);
		assert.match(painted.body, /Submission is blocked until they match/);
		assert.match(painted.body, /Add repayment|Repayment schedule/);

		assert.equal(
			await pollEvaluate(
				page,
				`(() => {
					${ACTIVATE}
					const submit = [...document.querySelectorAll('button')].find((button) =>
						/Create loan/.test(button.textContent ?? '')
					);
					if (!(submit instanceof HTMLElement)) return 'missing-submit';
					activate(submit);
					return 'clicked';
				})()`,
				(value) => value === 'clicked',
				'loan-submit'
			),
			'clicked'
		);
		const after = String(
			await page.evaluate(`(() => {
				const root = document.querySelector('[data-loan-schedule]');
				const submit = [...document.querySelectorAll('button')].find((button) =>
					/Create loan/.test(button.textContent ?? '')
				);
				return JSON.stringify({
					schedule: root instanceof HTMLElement,
					invalid: root?.getAttribute('data-invalid'),
					submit: submit instanceof HTMLElement
				});
			})()`)
		);
		const stayed = JSON.parse(after) as {
			readonly schedule: boolean;
			readonly invalid: string | null;
			readonly submit: boolean;
		};
		assert.equal(stayed.schedule, true, `form closed after blocked submit: ${after}`);
		assert.equal(stayed.invalid, 'true', after);
		assert.equal(stayed.submit, true, `Create loan gone: ${after}`);
	} finally {
		if (browser !== undefined) await browser.close();
		if (gateway !== undefined) await gateway.stop();
		await session.stop();
	}
});
