// @vitest-environment node
/**
 * L-TPL-project-delivery-006 in a real headless Chromium over `bolt dev`: creating a company waits for its NDA upload,
 * then persists the completed file.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

const root = process.cwd();
const port = 4390 + Math.floor(Math.random() * 100);
const origin = `http://127.0.0.1:${port}`;
const founder = 'founder@example.test';
let dev: ChildProcess;
let browser: Browser;

beforeAll(async () => {
	dev = spawn(
		process.execPath,
		[
			`${root}/node_modules/@norbital-ai/bolt/build/cli/main.js`,
			'dev',
			root,
			`--port=${port}`,
			'--seed=none',
			`--founder=${founder}`
		],
		{
			stdio: ['ignore', 'pipe', 'inherit']
		}
	);
	await new Promise<void>((ready, fail) => {
		let out = '';
		dev.stdout!.on('data', (chunk: Buffer) => {
			out += chunk;
			if (out.includes('dev ready')) ready();
		});
		dev.once('exit', (code) => fail(new Error(`bolt dev exited ${code}:\n${out}`)));
	});
	browser = await chromium.launch({ headless: true });
}, 180_000);
afterAll(async () => {
	await browser?.close();
	dev?.kill();
});

it('company creation waits for its NDA upload and persists the completed file', async () => {
	const context = await browser.newContext();
	for (const [path, data] of [
		['code', { address: founder }],
		['verify', { address: founder, code: '123456' }]
	] as const)
		expect((await context.request.post(`${origin}/__bolt/session/${path}`, { data })).ok()).toBe(
			true
		);
	const companies = async () => {
		const reply = await context.request.post(`${origin}/__bolt/q`, {
			data: {
				reads: [
					{ m: 'read', a: ['companies', { all: true, select: { name: true, nda_document: true } }] }
				]
			}
		});
		return (await reply.json()).answers[0].rows as {
			name: string;
			nda_document: { name: string; bytes: number } | null;
		}[];
	};
	const page = await context.newPage();
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/__bolt/files/companies.nda_document', async (route) => {
		await held;
		await route.continue();
	});
	await page.goto(`${origin}/app/crm/crm`);
	await page.getByRole('button', { name: 'New', exact: true }).first().click(); // the toolbar's; an empty table offers the same one in its placeholder
	await page.locator('input[id$="-name"]').fill('Client with an NDA');
	await page.locator('input[type="file"][id$="-nda_document"]').setInputFiles({
		name: 'signed-nda.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('Signed NDA fixture')
	});
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await page.waitForTimeout(1000);
	expect(await companies()).toEqual([]);
	release();
	await expect
		.poll(companies, { timeout: 15_000 })
		.toMatchObject([
			{ name: 'Client with an NDA', nda_document: { name: 'signed-nda.txt', bytes: 18 } }
		]);
	expect(errors).toEqual([]);
});
