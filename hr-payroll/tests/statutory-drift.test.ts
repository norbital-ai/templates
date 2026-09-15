// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The statutory drift automation's pure parts: the diff decides what changed and stands every
 * change on a quote that is on a retrieved page; the draft write carries the proposed rows in
 * place of the cloned ones; verification reads only the origins the version names.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	describeSourcesRead,
	diffStatutoryFindings,
	officialUrlFor,
	verifyStatutorySources
} from '../src/lib/statutory_research.ts';
import { applyProposedChanges, firstOfNextMonth } from '../src/automations/+statutory_drift.ts';
import { settingsDraftWrite } from '../src/lib/settings_clone.ts';
import { prefilterStatutorySources, researchOrigins } from '../src/lib/statutory_sources.ts';
import { LINEAGES, settingsVersions } from './fixtures/statutory-world.ts';

const page = {
	url: 'https://statutory.example.org/rates',
	requested_url: 'https://statutory.example.org/rates',
	text: 'From 1 January 2027 the employee contribution rate is 12% of wages and the employer rate is 13%.',
	links: [],
	sha256: 'a'.repeat(64),
	retrieved_at: '2026-09-07T00:00:00.000Z'
};
const OPT_IN_ID = '11111111-1111-4111-8111-111111111111';
const rule = (employee: string) => ({ when: 'base >= 0.0', employee, employer: '13.0' });
const sealed = {
	contributions: [{ code: 'EPF', name: 'Fund', authority: 'Act', rules: [rule('11.0')] }],
	leave_catalogue: [
		{
			code: 'ANNUAL',
			name: 'Annual leave',
			authority: 's.60E',
			entitlement: {
				availability: 'UPFRONT',
				year_start_month: 1,
				proration: 'NONE',
				bands: [{ eligibility: '', days: 8 }]
			}
		}
	]
};
const quote = 'the employee contribution rate is 12% of wages';

test('a changed rule table standing on a quote from a retrieved page is one change', () => {
	const diff = diffStatutoryFindings(
		sealed,
		{
			contributions: [{ code: 'EPF', rules: [rule('12.0')], source_url: page.url, quote }],
			leave_catalogue: [],
			notes: []
		},
		[page]
	);
	assert.equal(diff.changes.length, 1);
	assert.deepEqual(diff.changes[0], {
		collection: 'statutory_contributions',
		code: 'EPF',
		field: 'rules',
		previous: [rule('11.0')],
		proposed: [rule('12.0')],
		source_url: page.url,
		quote,
		retrieved_at: page.retrieved_at,
		sha256: page.sha256
	});
	assert.deepEqual(diff.notes, []);
});

test('an unchanged table, in any key or rule order, is no change', () => {
	const reordered = { employer: '13.0', employee: '11.0', when: 'base >= 0.0' };
	const diff = diffStatutoryFindings(
		sealed,
		{
			contributions: [{ code: 'EPF', rules: [reordered], source_url: page.url, quote }],
			leave_catalogue: [
				{
					code: 'ANNUAL',
					entitlement: {
						bands: [{ days: 8, eligibility: '' }],
						proration: 'NONE',
						year_start_month: 1,
						availability: 'UPFRONT'
					},
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
				{
					code: 'EPF',
					rules: [rule('12.0')],
					source_url: page.url,
					quote: 'invented sentence here'
				},
				{
					code: 'EPF',
					rules: [rule('12.0')],
					source_url: 'https://statutory.example.org/elsewhere',
					quote
				},
				{ code: 'SOCSO', rules: [rule('1.0')], source_url: page.url, quote }
			],
			leave_catalogue: [],
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

test('the proposed rules replace the cloned ones in the draft write', () => {
	const write = {
		code: 'PUB',
		name: 'draft',
		contribution_settings: [
			{ id: 's1', code: 'EPF', rules: [rule('11.0')] },
			{ id: 's2', code: 'OTHER', rules: [rule('5.0')] }
		],
		leave_catalogue_settings: [
			{ id: 'l1', code: 'ANNUAL', entitlement: sealed.leave_catalogue[0].entitlement }
		],
		payment_catalogue_settings: [{ id: 'p1', code: 'SEPARATION', bands: [] }]
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
				field: 'rules',
				previous: [rule('11.0')],
				proposed: [rule('12.0')],
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
	assert.equal(
		revised.change_summary,
		'Statutory drift: 1 change(s) proposed from v1 on 2026-09-07T00:00:00.000Z.'
	);
	assert.deepEqual(revised.contribution_settings[0].rules, [rule('12.0')]);
	assert.deepEqual(revised.contribution_settings[1], write.contribution_settings[1]);
	assert.deepEqual(revised.leave_catalogue_settings, write.leave_catalogue_settings);
	assert.deepEqual(revised.payment_catalogue_settings, write.payment_catalogue_settings);
});

test('a changed rate preserves and targets its rule ladder', () => {
	const first = { when: 'base <= 5000.0', employee: '11.0', employer: '13.0' };
	const second = { when: 'base > 5000.0', employee: '5.0', employer: '13.0' };
	const proposed = { ...first, employee: '12.0' };
	const facts = {
		...sealed,
		contributions: [{ ...sealed.contributions[0], rules: [first, second] }]
	};
	const diff = diffStatutoryFindings(
		facts,
		{
			contributions: [{ code: 'EPF', rules: [proposed], source_url: page.url, quote }],
			leave_catalogue: [],
			notes: []
		},
		[page]
	);
	assert.equal(diff.changes.length, 1);
	const result = applyProposedChanges(
		{ contribution_settings: [{ code: 'EPF', rules: [first, second] }] },
		diff.changes,
		{ changes: diff.changes }
	);
	assert.deepEqual(result.contribution_settings[0].rules, [proposed, second]);
});

test('a proposed version begins on the first of the month after today', () => {
	assert.equal(firstOfNextMonth('2026-09-07'), '2026-10-01');
	assert.equal(firstOfNextMonth('2026-12-31'), '2027-01-01');
});

test('verification reads only the origins the version names, and records what it read', async () => {
	const officialUrl = officialUrlFor(['https://statutory.example.org/rates']);
	assert.ok(officialUrl('https://statutory.example.org/other'));
	assert.equal(officialUrl('https://elsewhere.example.org/rates'), null);
	assert.equal(officialUrl('http://statutory.example.org/rates'), null);
	const reads: string[] = [];
	const read = await openViaTool(
		{
			readUrl: (url: string) =>
				Effect.sync(() => {
					reads.push(url);
					return {
						url,
						contentType: 'text/html',
						body: `<html><body><p>${page.text}</p></body></html>`
					};
				})
		},
		[page.url, 'https://elsewhere.example.org/x'],
		[page.url]
	);
	assert.deepEqual(
		read.pages.map((row) => row.url),
		[page.url]
	);
	assert.deepEqual(reads, [page.url], 'a page off the named origins is never fetched');
	assert.equal(read.unreachable.length, 1);
	assert.match(read.unreachable[0].reason, /only HTTPS pages on the origins the version names/);
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

/** Read a list of URLs the way the automation's verification does, recording both outcomes. */
const openViaTool = async (
	reader: unknown,
	urls: readonly string[],
	allowed: readonly string[] = urls
) => {
	const read = await Effect.runPromise(
		verifyStatutorySources(reader, urls, officialUrlFor(allowed))
	);
	return { pages: [...read.pages], unreachable: [...read.unreachable] };
};

test('a source that fails to resolve is recorded with url, reason and time while the others are read', async () => {
	const read = await openViaTool(partialReader([DOWN_URL]), [page.url, DOWN_URL]);
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
	const read = await openViaTool(partialReader([page.url, DOWN_URL]), [page.url, DOWN_URL]);
	assert.deepEqual(read.pages, []);
	assert.deepEqual(
		read.unreachable.map((row) => row.url),
		[page.url, DOWN_URL]
	);
	assert.ok(read.unreachable.every((row) => /ENOTFOUND/.test(row.reason)));
});

test('an HTTP-success browser challenge is recorded as unreadable rather than statutory evidence', async () => {
	const reader = {
		readUrl: (url: string) =>
			Effect.succeed({
				url,
				contentType: 'text/html',
				body: '<title>Checking your browser - reCAPTCHA</title><p>Checking your browser before accessing the official site. Click here if you are not automatically redirected after 5 seconds.</p>'
			})
	};
	const read = await openViaTool(reader, [page.url]);
	assert.deepEqual(read.pages, []);
	assert.equal(read.unreachable.length, 1);
	assert.match(read.unreachable[0].reason, /browser challenge/);
});

test('a cloned version carries every scheme’s base unchanged under the clone’s own id', () => {
	// A base names catalogue rows by family and code, so nothing is remapped.
	const base = {
		salary: true,
		absence: true,
		overtime: false,
		night_premium: false,
		entries: [{ family: 'LEAVE', code: 'ANNUAL' }]
	};
	const source = {
		id: 'source',
		code: 'SG',
		name: 'Singapore',
		effective_range: { start: '2026-01-01T00:00:00.000Z', end: null },
		work_rules: { proration: 'NONE', ordinary_divisor_days: '26.0', overtime_when: '', bands: [] }
	};
	const { write, schemeIds } = settingsDraftWrite(
		{
			source,
			schemes: [{ id: OPT_IN_ID, code: 'CPF', rules: [rule('11.0')], base }],
			catalogueLeaves: [{ id: 'l1', code: 'ANNUAL' }],
			loanCatalogue: [],
			claimCatalogue: [],
			allowanceCatalogue: [],
			paymentCatalogue: []
		},
		{ starts_on: '2026-02-01' }
	);
	const cloneId = schemeIds.get(OPT_IN_ID);
	assert.notEqual(cloneId, OPT_IN_ID);
	assert.equal(write.contribution_settings[0].id, cloneId);
	assert.deepEqual(write.contribution_settings[0].base, base);
	assert.deepEqual(write.leave_catalogue_settings[0].code, 'ANNUAL');
	assert.deepEqual(write.work_rules, source.work_rules);
});

test('research opens declarations: canonical sites in order, a news site is dropped by name', () => {
	const { kept, dropped } = prefilterStatutorySources('PH', [
		'https://www.sss.gov.ph/pay-contribution/',
		'https://www.philstar.com/headlines/2026/09/11/holidays-2027',
		'https://www.officialgazette.gov.ph/2025/09/03/proclamation-no-1006-s-2025/',
		'https://www.sss.gov.ph/pay-contribution/'
	]);
	assert.deepEqual(kept, [
		'https://www.officialgazette.gov.ph/2025/09/03/proclamation-no-1006-s-2025/',
		'https://www.sss.gov.ph/pay-contribution/'
	]);
	assert.equal(dropped.length, 1);
	assert.match(dropped[0]!.reason, /philstar\.com is not a canonical PH source/);
	// A jurisdiction the registry does not know keeps the operator's list as it stands.
	assert.deepEqual(prefilterStatutorySources('XX', ['https://example.org/law']).kept, [
		'https://example.org/law'
	]);
	// The agent may follow links on any canonical origin, listed or not.
	assert.ok(researchOrigins('PH', []).includes('https://www.officialgazette.gov.ph'));
});

test('every seeded version lists only canonical sources, and says how to navigate them', () => {
	for (const lineage of LINEAGES) {
		for (const version of settingsVersions(lineage)) {
			const sources = version.sources as { urls: string[]; instructions?: string };
			const { kept, dropped } = prefilterStatutorySources(
				String(version.jurisdiction_code),
				sources.urls
			);
			assert.deepEqual(dropped, [], `${lineage} ${String(version.name)} lists an off-canon source`);
			assert.ok(kept.length > 0, `${lineage} ${String(version.name)} lists no source`);
			assert.ok(
				(sources.instructions ?? '').length > 200,
				`${lineage} ${String(version.name)} carries no navigation instructions`
			);
		}
	}
});
