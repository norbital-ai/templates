import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startSessionGateway, workspaceDocumentHtml } from '@norbital-ai/bolt-server';
import {
	launchChromiumOrSkip,
	requireReleaseBundle,
	startSelfHostSession
} from '@norbital-ai/test-utilities';

test(
	'company creation waits for its NDA upload and persists the completed file',
	{ timeout: 90_000 },
	async () => {
		const { bundlePath } = requireReleaseBundle(
			fileURLToPath(new URL('../../.norbital/artifact/', import.meta.url)),
			['ai', 'database', 'tasks']
		);
		const session = await startSelfHostSession({ bundlePath, tenantId: 'project-upload-pending' });
		const gateway = await startSessionGateway({
			upstream: session.address,
			credential: session.credential!,
			cookieName: 'project_test',
			listen: { host: '127.0.0.1' },
			isDocument: (pathname) => pathname === '/' || pathname.startsWith('/app/'),
			rewritePath: (pathname) =>
				pathname.replace('/__bolt/command/', '/_bolt/command/').replace('/__bolt/sync/', '/sync/'),
			document: ({ browserSession }) =>
				workspaceDocumentHtml({
					tenantId: 'project-upload-pending',
					environment: 'test',
					releaseId: 'project-upload-pending',
					principal: 'project-upload-pending-founder',
					organizationName: 'Project test',
					commandPrefix: '/__bolt/command/',
					syncStreamUrl: `/__bolt/sync/stream?project_test=${browserSession}`,
					viewPath: '/app/crm',
					accessScope: 'operator',
					credential: session.credential!
				}).replace(
					'store: unavailable',
					`store: async (key, file) => {
			await new Promise(resolve => { window.finishTestUpload = resolve; });
			return '/files/' + key;
		}`
				)
		});
		let browser: Awaited<ReturnType<typeof launchChromiumOrSkip>>;
		try {
			// "ResizeObserver loop completed with undelivered notifications." is Chromium's benign
			// same-frame relayout notice, not a page fault.
			browser = await launchChromiumOrSkip(`window.testErrors = [];
			addEventListener('error', e => { if (!e.message.startsWith('ResizeObserver loop')) window.testErrors.push(e.message); });
			addEventListener('unhandledrejection', e => window.testErrors.push(String(e.reason)));`);
			assert.ok(browser, 'Chromium is required; this test cannot pass without a browser');
			const page = await browser.openPage(`http://127.0.0.1:${gateway.address.port}/app/crm`);
			const waitFor = async (expression: string) =>
				page.evaluate(`new Promise((resolve, reject) => {
			const check = () => { if (${expression}) { observer.disconnect(); clearTimeout(timer); resolve(true); } };
			const observer = new MutationObserver(check);
			const timer = setTimeout(() => { observer.disconnect(); reject(new Error('UI condition timed out: ' + ${JSON.stringify(expression)})); }, 15000);
			observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
			check();
		})`);
			const button = (name: string) =>
				`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(name)})`;
			await waitFor(button('New Company'));
			await page.evaluate(`${button('New Company')}.click()`);
			await waitFor(`document.querySelector('[data-collection-field="name"] input')`);
			await page.evaluate(`(() => {
			const input = document.querySelector('[data-collection-field="name"] input');
			input.value = 'Client with an NDA'; input.dispatchEvent(new Event('input', { bubbles: true }));
		})()`);
			await page.evaluate(`${button('No file uploaded')}.click()`);
			await waitFor(`document.querySelector('input[type="file"]')`);
			await page.evaluate(`(() => {
			const input = document.querySelector('input[type="file"]');
			const transfer = new DataTransfer();
			transfer.items.add(new File(['Signed NDA fixture'], 'signed-nda.txt', { type: 'text/plain' }));
			input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
		})()`);
			await waitFor(
				`typeof window.finishTestUpload === 'function' && ${button('Create')}?.disabled`
			);
			assert.equal((await session.query('select id from companies')).length, 0);
			await page.evaluate('window.finishTestUpload()');
			await waitFor(`${button('Create')} && !${button('Create')}.disabled`);
			await page.evaluate(`${button('Create')}.click()`);
			await waitFor(`!document.querySelector('[data-collection-field="name"] input')`);
			const [company] = await session.query('select name, nda_document from companies');
			assert.equal(company.name, 'Client with an NDA');
			assert.deepEqual(
				Object.fromEntries(
					Object.entries(company.nda_document as Record<string, unknown>).filter(
						([key]) => key !== 'storage_key'
					)
				),
				{
					file_name: 'signed-nda.txt',
					file_size: 18,
					mime_type: 'text/plain'
				}
			);
			assert.match(String((company.nda_document as Record<string, unknown>).storage_key), /\.txt$/);
			assert.deepEqual(await page.evaluate('window.testErrors'), []);
		} finally {
			await browser?.close();
			await gateway.stop();
			await session.stop();
		}
	}
);
