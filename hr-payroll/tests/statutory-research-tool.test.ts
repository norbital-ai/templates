import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Effect } from 'effect';
import type { AutomationApi } from '@norbital-ai/bolt/authoring';
import { statutoryResearchTool } from '../src/lib/statutory-research.js';

const OFFICIAL = 'https://www.bli.gov.tw';
const officialUrl = (value: string): URL | null => {
	if (!URL.canParse(value)) return null;
	const url = new URL(value);
	return url.protocol === 'https:' && url.hostname === 'www.bli.gov.tw' ? url : null;
};
const html = (body: string) =>
	`<html><head><title>BLI</title><script>x()</script></head><body>${body}</body></html>`;
const pagesOnSite: Record<string, string> = {
	[`${OFFICIAL}/en/`]: html(
		'<nav>Home About News</nav><p>Labor insurance overview.</p><a href="/en/rates">Contribution rates</a><a href="https://example.org/x">Elsewhere</a>'
	),
	[`${OFFICIAL}/en/rates`]: html(
		'<p>From 1 January 2026 the employer contribution rate is 7.5% of the insured monthly salary. The monthly insured salary ceiling is NT$45,800.</p>'
	)
};
const reads: string[] = [];
const api = {
	readUrl: (url: string) =>
		Effect.sync(() => {
			reads.push(url);
			const body = pagesOnSite[url];
			if (body === undefined) throw new Error(`no page at ${url}`);
			return { url, body, sha256: `sha256:${url.length}` };
		})
} as unknown as AutomationApi;

test('the research tool opens an allowed page, records it, and returns focused text with official links', async () => {
	const pages: Parameters<typeof statutoryResearchTool>[2] = [];
	const tool = statutoryResearchTool(api, officialUrl, pages);
	assert.equal(tool.name, 'read_official_page');
	const first = await Effect.runPromise(tool.run({ url: `${OFFICIAL}/en/` }));
	assert.equal(pages.length, 1);
	assert.equal(pages[0]?.url, `${OFFICIAL}/en/`);
	assert.deepEqual(first, {
		url: `${OFFICIAL}/en/`,
		text: 'BLI Home About News Labor insurance overview. Contribution rates Elsewhere',
		links: [`${OFFICIAL}/en/rates`]
	});
	const second = await Effect.runPromise(tool.run({ url: `${OFFICIAL}/en/rates` }));
	assert.equal(pages.length, 2);
	assert.match(second.text, /employer contribution rate is 7\.5%/);
	assert.ok(pages[1]?.text.includes('NT$45,800'), 'the full page text stays on the receipt');
	// A page already opened is served from the receipt, never fetched twice.
	await Effect.runPromise(tool.run({ url: `${OFFICIAL}/en/rates` }));
	assert.equal(pages.length, 2);
	assert.deepEqual(reads, [`${OFFICIAL}/en/`, `${OFFICIAL}/en/rates`]);
});

test('the research tool refuses an origin outside the official allow-list and records nothing', async () => {
	const pages: Parameters<typeof statutoryResearchTool>[2] = [];
	const tool = statutoryResearchTool(api, officialUrl, pages);
	const exit = await Effect.runPromiseExit(tool.run({ url: 'https://example.org/x' }));
	assert.equal(exit._tag, 'Failure');
	assert.match(JSON.stringify(exit), /allowed official HTTPS page/);
	assert.equal(pages.length, 0);
});
