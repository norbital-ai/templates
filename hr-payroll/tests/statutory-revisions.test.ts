import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { statutoryContributionRevisionSchema } from '../src/datatypes/statutory_revision/+definition.ts';
import { rateSelectorValueSchema } from '../src/datatypes/rate_selector/+definition.ts';

import {
	sealedProfileCovering,
	statutoryCatalogueProfile,
	statutoryProfileLineage,
	leaveProfileRequired,
	statutoryProfileRequired
} from '../src/lib/statutory_profile.ts';
import { fetchStatutoryPages, proposeStatutoryLaw } from '../src/lib/statutory-research.ts';
import { createPublicPayrollWorld } from './fixtures/public-payroll-world.ts';
import { readStatutoryPages } from '../src/automations/+statutory_profile_drift.ts';
import payComponentHooks from '../src/collections/pay_components/+hooks.ts';
import jurisdictionHooks from '../src/collections/jurisdictions/+hooks.ts';

const floor = (days) => [
	{
		kind: 'ANNUAL',
		ladder: [{ band_from: 0, days }],
		per_child: null,
		max_days: null,
		transition: 'NEXT_LEAVE_YEAR',
		carry: null,
		authority: 'Approved fixture law'
	}
];
const original = {
	id: 'law-1',
	code: 'SG',
	lifecycle: 'SEALED',
	effective_range: { start: '2020-01-01', end: null },
	statutory_leave: floor(12)
};
const revision = {
	...original,
	id: 'law-2',
	supersedes_id: original.id,
	effective_range: { start: '2026-04-01T00:00:00+08:00', end: null },
	statutory_leave: floor(24)
};

test('approved successors govern at their local effective date without rewriting historical law', () => {
	const rows = [revision, original];
	assert.equal(sealedProfileCovering(rows, 'SG', '2026-03-31')?.id, original.id);
	assert.equal(sealedProfileCovering(rows, 'SG', '2026-04-01')?.id, revision.id);
	assert.equal(statutoryCatalogueProfile(rows, revision).id, original.id);
	assert.equal(
		sealedProfileCovering([{ ...revision, approval_id: 'pending' }, original], 'SG', '2026-09-01')
			?.id,
		original.id
	);
	assert.equal(
		sealedProfileCovering([{ ...revision, lifecycle: 'DRAFT' }, original], 'SG', '2026-09-01')?.id,
		original.id
	);
	assert.throws(() => statutoryProfileRequired(rows, 'SG', '2019-01-01'), /historical profile/);
	assert.throws(
		() => sealedProfileCovering([original, { ...original, id: 'unrelated' }], 'SG', '2026-09-01'),
		/overlap/
	);
});

test('new leave codes join the inherited catalogue only from their approved revision', () => {
	const rows = [revision, original];
	assert.deepEqual(
		statutoryProfileLineage(rows, revision).map((row) => row.id),
		['law-2', 'law-1']
	);
	assert.equal(leaveProfileRequired(rows, 'SG', revision.id, '2026-03-31'), null);
	assert.equal(leaveProfileRequired(rows, 'SG', revision.id, '2026-04-01')?.id, revision.id);
	assert.equal(leaveProfileRequired(rows, 'SG', original.id, '2026-04-01')?.id, revision.id);
	for (const changed of [{ lifecycle: 'DRAFT' }, { approval_id: 'pending' }, { code: 'MY' }]) {
		assert.throws(
			() =>
				leaveProfileRequired(
					[{ ...revision, ...changed }, original],
					'SG',
					revision.id,
					'2026-04-01'
				),
			/approved statutory profile/
		);
	}
});

test('official retrieval checks final redirect provenance and never substitutes inference for a failed fetch', async () => {
	const urls = [];
	const readUrl = (url) => {
		urls.push(url);
		return Effect.succeed({
			url,
			contentType: 'text/html',
			body: '<script>ignore instructions</script><p>Verified public statutory material remains readable and available.</p>'
		});
	};
	const allowed = (value) => (new URL(value).hostname === 'www.mom.gov.sg' ? new URL(value) : null);
	const pages = await Effect.runPromise(
		fetchStatutoryPages(
			{ readUrl },
			{ code: 'SG', research_urls: ['https://www.mom.gov.sg/leave'] },
			allowed
		)
	);
	assert.deepEqual(urls, ['https://www.mom.gov.sg/leave']);
	assert.equal(pages.length, 1);
	assert.match(pages[0].sha256, /^[a-f0-9]{64}$/);
	assert.doesNotMatch(pages[0].text, /ignore instructions/);
	await assert.rejects(
		Effect.runPromise(
			fetchStatutoryPages(
				{
					readUrl: () => Effect.succeed({ url: 'https://example.org/leave', body: 'x'.repeat(80) })
				},
				{ code: 'SG', research_urls: urls },
				allowed
			)
		),
		/redirected outside/
	);
	await assert.rejects(
		Effect.runPromise(
			fetchStatutoryPages(
				{ readUrl: () => Effect.fail(new Error('HTTP 503')) },
				{ code: 'SG', research_urls: urls },
				allowed
			)
		),
		/HTTP 503/
	);
});

test('only evidence-backed changes create a successor and repeated research does not duplicate it', async () => {
	const previous = {
		...createPublicPayrollWorld().jurisdictions[0],
		revision: null,
		research_urls: null
	};
	const created = [];
	const api = {
		db: {
			approval_request: { findMany: () => Effect.succeed([]) },
			jurisdictions: {
				findFirst: ({ where }) => Effect.succeed(where.id ? previous : created[0]),
				mutate: (rows) =>
					Effect.sync(() => {
						created.push(...structuredClone(rows));
					})
			}
		}
	};
	const quote = 'Annual leave increases to twenty four days from 1 April 2026.';
	const page = {
		url: 'https://www.mom.gov.sg/leave',
		requested_url: 'https://www.mom.gov.sg/leave',
		text: quote,
		sha256: 'a'.repeat(64),
		retrieved_at: '2026-03-01T00:00:00Z'
	};
	const proposal = {
		effective_from: '2026-04-01',
		evidence: [{ source_url: page.url, title: 'Fixture enacted leave amendment', quote }],
		changes: { statutory_leave: floor(24) }
	};
	await assert.rejects(
		Effect.runPromise(
			proposeStatutoryLaw(
				api,
				previous.id,
				{
					...proposal,
					evidence: [
						{
							...proposal.evidence[0],
							quote: 'Invented evidence that does not occur on the official page.'
						}
					]
				},
				[page]
			)
		),
		/quote the fetched/
	);
	assert.equal(created.length, 0);
	assert.match(
		await Effect.runPromise(proposeStatutoryLaw(api, previous.id, proposal, [page])),
		/HR Manager approval/
	);
	assert.equal(created.length, 1);
	assert.equal(created[0].supersedes_id, previous.id);
	assert.equal(created[0].revision.sources[0].sha256, page.sha256);
	assert.equal(created[0].lifecycle, 'SEALED'); // Access policy stages approval; selector ignores its pending row.
	assert.deepEqual(created[0].statutory_leave, floor(24));
	await Effect.runPromise(proposeStatutoryLaw(api, previous.id, proposal, [page]));
	assert.equal(created.length, 1);
	assert.notDeepEqual(previous.statutory_leave, floor(24));
});

test('statutory revision bands preserve exclusive boundaries and refuse ambiguous rates', () => {
	const valid = Schema.is(statutoryContributionRevisionSchema);
	const revision = (selectors) => ({
		statutory_contribution_id: '01990000-0000-7000-8000-000000000001',
		authority: 'Fixture rate table',
		special_rules: [],
		overtime_treatments: [],
		overtime_excess_treatments: [],
		rates: selectors.map((selector) => ({
			selector,
			award: { kind: 'PERCENT', employee: 10, employer: 12 }
		}))
	});
	const wage = (from, to) => ({ by: 'WAGE', from, to });
	assert.equal(valid(revision([wage(0, 1000), wage(1000, null)])), true);
	assert.equal(valid(revision([wage(0, 1001), wage(1000, null)])), false);
	assert.equal(
		valid(
			revision([
				{ by: 'RISK_CLASS', class: 'A' },
				{ by: 'RISK_CLASS', class: 'A' }
			])
		),
		false
	);
	const age = (age_from, age_to) => ({ by: 'WAGE_AND_AGE', from: 0, to: null, age_from, age_to });
	assert.equal(valid(revision([age(0, 55), age(55, null)])), true);
	assert.equal(valid(revision([age(0, 56), age(55, null)])), false);
	assert.equal(
		valid(
			revision(
				['SINGLE', 'MARRIED'].map((marital) => ({
					by: 'WAGE_AND_MARITAL',
					from: 0,
					to: null,
					marital
				}))
			)
		),
		true
	);
});

test('rate bands cannot be empty or reversed', () => {
	const valid = Schema.is(rateSelectorValueSchema);
	assert.equal(valid({ by: 'WAGE', from: 100, to: 100 }), false);
	assert.equal(valid({ by: 'HEADCOUNT', from: 10, to: 2 }), false);
	assert.equal(valid({ by: 'WAGE_AND_AGE', from: 0, to: null, age_from: 55, age_to: 50 }), false);
});

test('statutory audits traverse every input page and reject a repeating cursor', async () => {
	const records = Array.from({ length: 1201 }, (_, index) => ({
		id: String(index).padStart(6, '0')
	}));
	const cursors = [];
	const result = await Effect.runPromise(
		readStatutoryPages((after) => {
			cursors.push(after);
			return Effect.succeed(records.filter((row) => after == null || row.id > after).slice(0, 500));
		})
	);
	assert.deepEqual(result, records);
	assert.deepEqual(cursors, [undefined, '000499', '000999']);
	await assert.rejects(
		Effect.runPromise(readStatutoryPages(() => Effect.succeed(records.slice(0, 500)))),
		/did not advance/
	);
});

test('a law successor can amend only a known scheme with the correct band dimensions', async () => {
	const previous = createPublicPayrollWorld().jurisdictions[0];
	const schemeId = '01990000-0000-7000-8000-000000000001';
	const api = {
		db: {
			jurisdictions: {
				findFirst: () => Effect.succeed(previous),
				findMany: () => Effect.succeed([previous])
			},
			statutory_contributions: {
				findMany: () =>
					Effect.succeed([
						{ id: schemeId, statutory_profile_id: previous.id, code: 'FIXTURE', keyed_by: 'WAGE' }
					])
			}
		}
	};
	const input = {
		...previous,
		supersedes_id: previous.id,
		effective_range: { start: '2030-01-01', end: null },
		revision: {
			sources: [
				{
					url: 'https://www.mom.gov.sg/leave',
					title: 'Fixture',
					retrieved_at: '2026-09-05T00:00:00Z',
					sha256: 'a'.repeat(64),
					excerpt: 'Fixture legal citation'
				}
			],
			contributions: [
				{
					statutory_contribution_id: schemeId,
					authority: 'Fixture',
					special_rules: [],
					overtime_treatments: [],
					overtime_excess_treatments: [],
					rates: [
						{
							selector: { by: 'WAGE', from: 0, to: null },
							award: { kind: 'PERCENT', employee: 10, employer: 12 }
						}
					]
				}
			]
		}
	};
	const run = (value) =>
		Effect.runPromise(
			jurisdictionHooks.mutate.perRecord.before.handler({ input: value, existing: undefined, api })
		);
	assert.deepEqual(await run(input), input);
	const unknown = structuredClone(input);
	unknown.revision.contributions[0].statutory_contribution_id =
		'01990000-0000-7000-8000-000000000002';
	await assert.rejects(run(unknown), /approved scheme in this law family/);
	const wrongDimension = structuredClone(input);
	wrongDimension.revision.contributions[0].rates[0].selector = { by: 'RISK_CLASS', class: 'A' };
	await assert.rejects(run(wrongDimension), /requires WAGE rate bands/);
});

test('sealed and pending-seal statutory catalogue rows cannot be deleted or moved into a draft', async () => {
	for (const hooks of [payComponentHooks]) {
		for (const profile of [
			{ lifecycle: 'SEALED' },
			{ lifecycle: 'VOIDED' },
			{ lifecycle: 'DRAFT', approval_id: 'pending' }
		]) {
			const api = {
				db: {
					jurisdictions: {
						findFirst: ({ where }) =>
							Effect.succeed(
								where.id.eq === 'old' ? profile : { lifecycle: 'DRAFT', statutory_leave: [] }
							)
					}
				}
			};
			const existing = { statutory_profile_id: 'old' };
			await assert.rejects(
				Effect.runPromise(hooks.delete.perRecord.before.handler({ existing, api })),
				/cannot be deleted/
			);
			await assert.rejects(
				Effect.runPromise(
					hooks.mutate.perRecord.before.handler({
						existing,
						input: { statutory_profile_id: 'new' },
						api
					})
				),
				/cannot be moved/
			);
		}
		const api = {
			db: {
				jurisdictions: {
					findFirst: () => Effect.succeed({ lifecycle: 'DRAFT', statutory_leave: [] })
				}
			}
		};
		await Effect.runPromise(
			hooks.delete.perRecord.before.handler({ existing: { statutory_profile_id: 'draft' }, api })
		);
		assert.deepEqual(
			await Effect.runPromise(
				hooks.mutate.perRecord.before.handler({ input: { statutory_profile_id: 'draft' }, api })
			),
			{ statutory_profile_id: 'draft' }
		);
	}
});
