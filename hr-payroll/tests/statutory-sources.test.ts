import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { fetchStatutoryPages, proposeStatutorySource } from '../src/lib/statutory-research.ts';
import { validateResearchReceipt } from '../src/automations/+statutory_profile_drift.ts';
import sourceHooks from '../src/collections/statutory_research_sources/+hooks.ts';

const source = 'https://www.mom.gov.sg/leave';
const candidate = 'https://statutory.example.org/leave';
const quote = 'The statutory authority publishes new guidance on the linked official portal.';
const proposal = {
	url: candidate,
	title: 'Statutory portal',
	rationale: 'Linked by the approved authority.',
	source_url: source,
	quote
};
const report = {
	summary: 'Verified guidance.',
	highlights: [],
	changes_to_review: [],
	official_sources: [{ title: 'Guidance', url: candidate, jurisdiction_code: 'SG', finding: quote }]
};

test('a new origin is refused until explicitly approved and never admits credentials or custom ports', () => {
	assert.throws(() => validateResearchReceipt(report, ['SG']), /not an allowed official HTTPS/);
	assert.doesNotThrow(() => validateResearchReceipt(report, ['SG'], [candidate]));
	for (const url of [
		'https://user:pass@statutory.example.org/leave',
		'https://statutory.example.org:8443/leave',
		'https://sub.statutory.example.org/leave'
	]) {
		assert.throws(
			() =>
				validateResearchReceipt(
					{ ...report, official_sources: [{ ...report.official_sources[0], url }] },
					['SG'],
					[candidate]
				),
			/not an allowed official HTTPS/
		);
	}
});

test('source discovery retains raw evidence and proposes the linked site without fetching it', async () => {
	const reads = [];
	const created = [];
	const api = {
		readUrl: (url) => {
			reads.push(url);
			return Effect.succeed({
				url,
				contentType: 'text/html',
				body: `<p>${quote}</p><a href="${candidate}">Guidance</a>`,
				sha256: 'a'.repeat(64)
			});
		},
		db: {
			statutory_research_sources: {
				findFirst: () => Effect.succeed(created[0]),
				mutate: (rows) =>
					Effect.sync(() => {
						created.push(...rows);
					})
			},
			approval_request: { findMany: () => Effect.succeed([]) }
		}
	};
	const pages = await Effect.runPromise(
		fetchStatutoryPages(api, { code: 'SG', research_urls: [source] }, (url) =>
			url === source ? new URL(url) : null
		)
	);
	assert.deepEqual(reads, [source]);
	assert.equal(pages[0].sha256, 'a'.repeat(64));
	await Effect.runPromise(proposeStatutorySource(api, 'SG', proposal, pages));
	assert.equal(created.length, 1);
	assert.equal(created[0].source_sha256, 'a'.repeat(64));
	assert.equal(created[0].discovered_from, source);
	assert.equal(created[0].excerpt, quote);
	assert.deepEqual(reads, [source]);
	assert.equal(await Effect.runPromise(proposeStatutorySource(api, 'SG', proposal, pages)), null);
	for (const bad of [
		{ ...proposal, url: 'https://invented.example.org/' },
		{ ...proposal, quote: 'An invented claim that the authority never stated.' }
	]) {
		await assert.rejects(
			Effect.runPromise(proposeStatutorySource(api, 'SG', bad, pages)),
			/linked and quoted/
		);
	}
});

test('oversized source evidence is refused rather than silently truncated', async () => {
	await assert.rejects(
		Effect.runPromise(
			fetchStatutoryPages(
				{ readUrl: () => Effect.succeed({ url: source, body: 'x'.repeat(80_001) }) },
				{ code: 'SG', research_urls: [source] },
				(url) => new URL(url)
			)
		),
		/exceeds the research text limit/
	);
});

test('approved source evidence stays immutable while revocation preserves the row', () => {
	const before = sourceHooks.mutate.perRecord.before.handler;
	const existing = {
		jurisdiction_code: 'SG',
		title: proposal.title,
		url: candidate,
		rationale: proposal.rationale,
		active: true
	};
	assert.deepEqual(before({ input: { active: false }, existing }), { active: false });
	assert.throws(
		() => before({ input: { url: 'https://replacement.example.org/' }, existing }),
		/cannot change/
	);
	assert.throws(() => before({ input: { jurisdiction_code: 'MY' }, existing }), /cannot change/);
});
