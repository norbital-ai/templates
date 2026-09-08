// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The statutory drift automation's pure parts: the diff decides what changed and stands every
 * change on a quote that is on a retrieved page; the draft write carries the proposed rows in
 * place of the cloned ones; the research tool opens only the origins the version names.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	describeSourcesRead,
	diffStatutoryFindings,
	fetchStatutoryPages,
	officialUrlFor,
	statutoryResearchTool
} from '../src/lib/statutory_research.ts';
import { applyProposedChanges, firstOfNextMonth } from '../src/automations/+statutory_drift.ts';

const page = {
	url: 'https://statutory.example.org/rates',
	requested_url: 'https://statutory.example.org/rates',
	text: 'From 1 January 2027 the employee contribution rate is 12% of wages and the employer rate is 13%.',
	links: [],
	sha256: 'a'.repeat(64),
	retrieved_at: '2026-09-07T00:00:00.000Z'
};
const band = (employee: number) => ({
	selector: { by: 'WAGE', from: 0, to: null },
	award: { kind: 'PERCENT', employee, employer: 13 }
});
const sealed = {
	contributions: [{ code: 'EPF', name: 'Fund', authority: 'Act', bands: [band(11)] }],
	leave_catalogue: [
		{
			code: 'ANNUAL',
			name: 'Annual leave',
			authority: 's.60E',
			entitlement: {
				availability: 'UPFRONT',
				year_start_month: 1,
				proration: 'NONE',
				bands: [{ band_from: 0, days: 8 }]
			}
		}
	],
	pay_component: [{ code: 'OVERTIME', contribution_treatments: { EPF: { kind: 'EXCLUDE' } } }]
};
const quote = 'the employee contribution rate is 12% of wages';

test('a changed band table standing on a quote from a retrieved page is one change', () => {
	const diff = diffStatutoryFindings(
		sealed,
		{
			contributions: [{ code: 'EPF', bands: [band(12)], source_url: page.url, quote }],
			leave_catalogue: [],
			pay_component: [],
			notes: []
		},
		[page]
	);
	assert.equal(diff.changes.length, 1);
	assert.deepEqual(diff.changes[0], {
		collection: 'statutory_contributions',
		code: 'EPF',
		field: 'bands',
		previous: [band(11)],
		proposed: [band(12)],
		source_url: page.url,
		quote,
		retrieved_at: page.retrieved_at,
		sha256: page.sha256
	});
	assert.deepEqual(diff.notes, []);
});

test('an unchanged table, in any key or band order, is no change', () => {
	const reordered = {
		award: { employer: 13, employee: 11, kind: 'PERCENT' },
		selector: { to: null, from: 0, by: 'WAGE' }
	};
	const diff = diffStatutoryFindings(
		sealed,
		{
			contributions: [{ code: 'EPF', bands: [reordered], source_url: page.url, quote }],
			leave_catalogue: [
				{
					code: 'ANNUAL',
					entitlement: {
						bands: [{ days: 8, band_from: 0 }],
						proration: 'NONE',
						year_start_month: 1,
						availability: 'UPFRONT'
					},
					source_url: page.url,
					quote
				}
			],
			pay_component: [
				{
					code: 'OVERTIME',
					contribution_treatments: { EPF: { kind: 'EXCLUDE' } },
					source_url: page.url,
					quote
				}
			],
			notes: ['A revision is announced for 2028.']
		},
		[page]
	);
	assert.deepEqual(diff.changes, []);
	assert.deepEqual(diff.notes, ['A revision is announced for 2028.']);
});

test('a quote not on the page, a page not retrieved and an unknown code are notes, never changes', () => {
	const diff = diffStatutoryFindings(
		sealed,
		{
			contributions: [
				{ code: 'EPF', bands: [band(12)], source_url: page.url, quote: 'invented sentence here' },
				{
					code: 'EPF',
					bands: [band(12)],
					source_url: 'https://statutory.example.org/elsewhere',
					quote
				},
				{ code: 'SOCSO', bands: [band(1)], source_url: page.url, quote }
			],
			leave_catalogue: [],
			pay_component: [],
			notes: []
		},
		[page]
	);
	assert.deepEqual(diff.changes, []);
	assert.equal(diff.notes.length, 3);
	assert.match(diff.notes[0], /quote does not appear/);
	assert.match(diff.notes[1], /was not retrieved/);
	assert.match(diff.notes[2], /not a statutory scheme/);
});

test('the proposed bands replace the cloned ones in the draft write', () => {
	const write = {
		code: 'PUB',
		name: 'draft',
		contribution_settings: [
			{ id: 's1', code: 'EPF', bands: [band(11)] },
			{ id: 's2', code: 'OTHER', bands: [band(5)] }
		],
		leave_catalogue_settings: [
			{ id: 'l1', code: 'ANNUAL', entitlement: sealed.leave_catalogue[0].entitlement }
		],
		work_catalogue_settings: [
			{
				id: 'w1',
				code: 'STANDARD',
				overtime: { code: 'OVERTIME', sequence: 20, contribution_treatments: {} }
			}
		],
		payment_catalogue_settings: [
			{ id: 'p1', code: 'SEPARATION', contribution_treatments: { EPF: { kind: 'EXCLUDE' } } }
		]
	};
	const proposal = {
		proposed_by: 'statutory_drift',
		run_id: 'run',
		proposed_at: '2026-09-07T00:00:00.000Z',
		source_version_id: 'v1',
		changes: [
			{
				collection: 'statutory_contributions',
				code: 'EPF',
				field: 'bands',
				previous: [band(11)],
				proposed: [band(12)],
				source_url: page.url,
				quote,
				retrieved_at: page.retrieved_at,
				sha256: page.sha256
			},
			{
				collection: 'pay_component',
				code: 'OVERTIME',
				field: 'contribution_treatments',
				previous: {},
				proposed: { EPF: { kind: 'INCLUDE' } },
				source_url: page.url,
				quote,
				retrieved_at: page.retrieved_at,
				sha256: page.sha256
			}
		],
		notes: [],
		unreachable: []
	};
	const revised = applyProposedChanges(write, proposal.changes, proposal);
	assert.equal(revised.research_notes, proposal);
	assert.deepEqual(revised.contribution_settings[0].bands, [band(12)]);
	assert.deepEqual(revised.contribution_settings[1], write.contribution_settings[1]);
	assert.deepEqual(revised.leave_catalogue_settings, write.leave_catalogue_settings);
	assert.deepEqual(revised.work_catalogue_settings[0].overtime.contribution_treatments.EPF, {
		kind: 'INCLUDE'
	});
	assert.deepEqual(revised.payment_catalogue_settings, write.payment_catalogue_settings);
});

test('a proposed version begins on the first of the month after today', () => {
	assert.equal(firstOfNextMonth('2026-09-07'), '2026-10-01');
	assert.equal(firstOfNextMonth('2026-12-31'), '2027-01-01');
});

test('the research tool opens only the origins the version names, and records what it opened', async () => {
	const officialUrl = officialUrlFor(['https://statutory.example.org/rates']);
	assert.ok(officialUrl('https://statutory.example.org/other'));
	assert.equal(officialUrl('https://elsewhere.example.org/rates'), null);
	assert.equal(officialUrl('http://statutory.example.org/rates'), null);
	const reads: string[] = [];
	const api = {
		readUrl: (url: string) =>
			Effect.sync(() => {
				reads.push(url);
				return {
					url,
					contentType: 'text/html',
					body: `<html><body><p>${page.text}</p><a href="/en/rates">Rates</a><a href="https://elsewhere.example.org/x">Elsewhere</a></body></html>`
				};
			})
	};
	const pages = [];
	const tool = statutoryResearchTool(api, officialUrl, pages);
	assert.equal(tool.name, 'read_official_page');
	const first = await Effect.runPromise(tool.run({ url: page.url }));
	assert.equal(pages.length, 1);
	assert.match(first.text, /employee contribution rate is 12%/);
	assert.deepEqual(first.links, ['https://statutory.example.org/en/rates']);
	await Effect.runPromise(tool.run({ url: page.url }));
	assert.deepEqual(reads, [page.url], 'a page already opened is served from the receipt');
	const refused = await Effect.runPromiseExit(tool.run({ url: 'https://elsewhere.example.org/x' }));
	assert.equal(refused._tag, 'Failure');
	assert.equal(pages.length, 1);
});

const DOWN_URL = 'https://down.statutory.example.org/rates';

/** A page reader where the entry page answers and a second source does not resolve. */
const partialReader = (failing: readonly string[]) => ({
	readUrl: (url: string) =>
		failing.includes(url)
			? Effect.fail(new Error(`getaddrinfo ENOTFOUND ${new URL(url).hostname}`))
			: Effect.succeed({
					url,
					contentType: 'text/html',
					body: `<html><body><p>${page.text}</p></body></html>`
				})
});

test('a source that fails to resolve is recorded with url, reason and time while the others are read', async () => {
	const officialUrl = officialUrlFor([page.url, DOWN_URL]);
	const read = await Effect.runPromise(
		fetchStatutoryPages(partialReader([DOWN_URL]), [page.url, DOWN_URL], officialUrl)
	);
	assert.deepEqual(
		read.pages.map((row) => row.url),
		[page.url]
	);
	assert.equal(read.unreachable.length, 1);
	const [source] = read.unreachable;
	assert.equal(source.url, DOWN_URL);
	assert.equal(source.reason, 'getaddrinfo ENOTFOUND down.statutory.example.org.');
	assert.match(source.retrieved_at, /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(
		describeSourcesRead(2, read.unreachable),
		`1 of 2 sources read; unreachable: ${DOWN_URL} (getaddrinfo ENOTFOUND down.statutory.example.org.)`
	);
	assert.equal(describeSourcesRead(2, []), '2 of 2 sources read.');
});

test('every source failing is no page and every source recorded, never a silent empty read', async () => {
	const officialUrl = officialUrlFor([page.url, DOWN_URL]);
	const read = await Effect.runPromise(
		fetchStatutoryPages(partialReader([page.url, DOWN_URL]), [page.url, DOWN_URL], officialUrl)
	);
	assert.deepEqual(read.pages, []);
	assert.deepEqual(
		read.unreachable.map((row) => row.url),
		[page.url, DOWN_URL]
	);
	assert.ok(read.unreachable.every((row) => /ENOTFOUND/.test(row.reason)));
});

test('a refusal of this module is a recorded reason too: an origin the version does not name', async () => {
	const officialUrl = officialUrlFor([page.url]);
	const read = await Effect.runPromise(
		fetchStatutoryPages(partialReader([]), [page.url, DOWN_URL], officialUrl)
	);
	assert.equal(read.pages.length, 1);
	assert.equal(read.unreachable.length, 1);
	assert.equal(read.unreachable[0].url, DOWN_URL);
	assert.match(read.unreachable[0].reason, /only HTTPS pages on the origins the version names/);
});
