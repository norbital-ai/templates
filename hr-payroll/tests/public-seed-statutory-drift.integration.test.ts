import test from 'node:test';
import assert from 'node:assert/strict';
import { failure, makeWireError, success } from '@norbital-ai/bolt-protocol';
import { makeAiBinding } from '@norbital-ai/bolt-server';
import { Schema } from 'effect';
import { Prompt } from 'effect/unstable/ai';
import { asRecord, bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	STATUTORY_PUB_EPF_ID,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

/**
 * The statutory drift automation on the public seed, with a recorded double for the model and the
 * page reader: one changed rate produces exactly one draft version carrying the proposal note and
 * the changed band; an unchanged lineage produces nothing; a second run produces no second draft
 * while the first is open; a lineage whose research fails is reported by name while the others
 * proceed; and nothing sealed changes. The page reader double refuses to resolve one of PUB's two
 * sources, so the draft is created from the one that answered and its sheet names the other with
 * the reason; a lineage none of whose sources answer gets no draft and is named in the result.
 */

type Row = Readonly<Record<string, unknown>>;

const PUB_URL = 'https://statutory.example.org/pub/rates';
/** PUB's second source, which the page reader double cannot resolve. */
const PUB_DOWN_URL = 'https://down.statutory.example.org/pub/notice';
const PUB2_ID = '22222222-2222-4222-8222-222222222233';
const PUB2_SCHEME_ID = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaab1';
const PUB2_URL = 'https://statutory.example.org/pub2/rates';

/** The public fixture's PUB-EPF band, as seeded: employee 11%, employer 13%. */
const sealedBand = {
	selector: { by: 'WAGE', from: 0, to: null },
	award: { kind: 'PERCENT', employee: 11, employer: 13 }
};
const proposedBand = { ...sealedBand, award: { ...sealedBand.award, employee: 12 } };
const pub2Band = {
	selector: { by: 'WAGE', from: 0, to: null },
	award: { kind: 'PERCENT', employee: 5, employer: 5 }
};

const pubQuote =
	'From 1 January 2027 the employee contribution rate is 12% of wages and the employer rate is 13%.';
const pub2Quote = 'The employee and employer contribution rates remain 5% of wages each.';

const testAiCatalog = {
	_tag: 'Catalog' as const,
	languageModels: [{ id: 'test/language' }],
	defaultLanguageModelId: 'test/language',
	embeddingModels: [{ id: 'test/embedding' }],
	defaultEmbeddingModelId: 'test/embedding'
};

const encodeMessage = Schema.encodeSync(Prompt.Message);

/**
 * The research double answers by turn kind. The first tool turn per lineage opens the entry page
 * through `read_official_page` (the loop's only tool), the next tool turn stops calling tools,
 * and the closing structured turn returns the recorded findings, so the test walks the real tool
 * loop. PUB's findings raise the employee rate; PUB2's restate the sealed band.
 */
const driftAi = (failPub2: () => boolean) => {
	const toolTurns = new Map<string, number>();
	return makeAiBinding({
		call: async (_metadata, request) => {
			if (request._tag !== 'Generate') return testAiCatalog;
			const prompt = JSON.stringify(request);
			const code = /Lineage (PUB2|PUB)\b/.exec(prompt)?.[1] ?? 'PUB';
			if (code === 'PUB2' && failPub2()) throw new Error('PUB2 evidence unavailable');
			const url = code === 'PUB' ? PUB_URL : PUB2_URL;
			const observation = {
				callId: request.callId,
				provider: 'fixture',
				model: 'provider/model',
				operation: 'language' as const,
				charge: { currency: 'USD', coefficient: '125', scale: 6 },
				chargeSource: 'provider' as const
			};
			if (request.output._tag === 'Message') {
				const turn = (toolTurns.get(code) ?? 0) + 1;
				toolTurns.set(code, turn);
				assert.ok(
					request.output.tools?.some((tool) => tool.name === 'read_official_page'),
					'the research turn offers read_official_page'
				);
				return {
					_tag: 'Generated',
					result: {
						_tag: 'Message',
						message: encodeMessage(
							Prompt.assistantMessage({
								content:
									turn % 2 === 1
										? [
												Prompt.toolCallPart({
													id: `read-${code}-${turn}`,
													name: 'read_official_page',
													params: { url },
													providerExecuted: false
												})
											]
										: [Prompt.textPart({ text: `Evidence gathered for ${code}.` })]
							})
						)
					},
					observation
				};
			}
			return {
				_tag: 'Generated',
				result: {
					_tag: 'Object',
					value:
						code === 'PUB'
							? {
									contributions: [
										{ code: 'PUB-EPF', bands: [proposedBand], source_url: url, quote: pubQuote }
									],
									leave_catalogue: [],
									pay_component: [],
									notes: []
								}
							: {
									contributions: [
										{ code: 'PUB2-EPF', bands: [pub2Band], source_url: url, quote: pub2Quote }
									],
									leave_catalogue: [],
									pay_component: [],
									notes: ['No change announced.']
								}
				},
				observation
			};
		}
	});
};

test(
	'statutory drift proposes one draft for a changed band, nothing for an unchanged lineage, and no second draft while the first is open',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS * 2 },
	async () => {
		let failPub2 = false;
		const retrievedUrls: string[] = [];
		const unresolvable = new Set([PUB_DOWN_URL]);
		const session = await startPublicSeedHost('hr-payroll-statutory-drift', {
			ai: driftAi(() => failPub2),
			connector: {
				call: async (_metadata, request) => {
					const url = String(asRecord(request.input, 'web request').url);
					retrievedUrls.push(url);
					if (unresolvable.has(url))
						return failure(
							makeWireError('web.read_failed', `getaddrinfo ENOTFOUND ${new URL(url).hostname}`, {
								retryable: false,
								outcome: 'known'
							})
						);
					const quote = url === PUB_URL ? pubQuote : pub2Quote;
					return success({
						output: {
							url,
							contentType: 'text/html',
							body: `<html><body><p>${quote}</p></body></html>`
						}
					});
				}
			}
		});
		try {
			// PUB names its official page and a second source that does not resolve; PUB2 is a second
			// lineage in force whose page restates its band.
			await session.query(
				`update jurisdiction_settings set research_urls = array[$1, $2]::text[] where id = $3`,
				[PUB_URL, PUB_DOWN_URL, JURISDICTION_ID]
			);
			await session.query(
				`insert into jurisdiction_settings (id, code, jurisdiction_code, name, sealed_at, currency, tax_year_start_month, research_urls, effective_range)
				 values ($1, 'PUB2', 'TEST-JUR', 'Second fixture lineage', '2020-01-01T00:00:00.000Z', 'MYR', 1, array[$2]::text[], $3)`,
				[PUB2_ID, PUB2_URL, { start: '2020-01-01', end: null }]
			);
			await session.query(
				`insert into statutory_contributions (id, settings_id, code, name, is_statutory, authority, payer, keyed_by, rounding, relief_for, sequence, special_rules)
				 values ($1, $2, 'PUB2-EPF', 'Second fixture fund', true, 'Public fixture', 'BOTH', 'WAGE', 'NEAREST_CENT', '{}', 1, '{}')`,
				[PUB2_SCHEME_ID, PUB2_ID]
			);
			await session.query(
				`insert into contribution_rates (id, statutory_contribution_id, selector, award) values ($1, $2, $3, $4)`,
				[crypto.randomUUID(), PUB2_SCHEME_ID, pub2Band.selector, pub2Band.award]
			);
			const sealedBefore = await session.query(
				`select s.id, s.row_version, r.award from jurisdiction_settings s join statutory_contributions c on c.settings_id = s.id join contribution_rates r on r.statutory_contribution_id = c.id where s.sealed_at is not null order by r.id`
			);

			const start = () =>
				postGuestCommand(
					session.host.baseUrl,
					'automations.start',
					{ name: 'statutory_drift', input: {} },
					bearerHeaders(session.credential)
				);
			const runOf = async (taskId: unknown) =>
				asRecord(
					(
						await session.query(
							`select status, result, error from automation_run where task_id = $1`,
							[taskId]
						)
					)[0],
					'automation run'
				);
			const drafts = () =>
				session.query(
					`select id, code, name, sealed_at, cloned_from_id, effective_range, research_notes from jurisdiction_settings where sealed_at is null order by created_at`
				) as Promise<Row[]>;

			// Run 1: PUB differs, PUB2 does not.
			const first = await start();
			assert.ok(
				first.status < 300,
				`automations.start returned ${first.status}: ${JSON.stringify(first.value)}`
			);
			const run = await runOf(asRecord(first.value, 'start').taskId);
			assert.equal(run.status, 'done', `drift run failed: ${JSON.stringify(run)}`);
			const result = asRecord(run.result, 'drift result');
			assert.equal(result.proposals, 1, JSON.stringify(result));
			const lineages = result.lineages as ReadonlyArray<Record<string, unknown>>;
			assert.deepEqual(
				lineages.map((row) => [row.code, row.status, row.changes]),
				[
					['PUB', 'proposed', 1],
					['PUB2', 'unchanged', 0]
				],
				JSON.stringify(lineages)
			);
			assert.ok(
				retrievedUrls.includes(PUB_URL) && retrievedUrls.includes(PUB2_URL),
				'both entry pages were read'
			);
			assert.ok(retrievedUrls.includes(PUB_DOWN_URL), 'the unresolvable source was attempted');
			// The source that did not resolve is on the result, by url and reason, beside the count.
			const pubSources = asRecord(lineages[0]!.sources, 'PUB sources');
			assert.equal(pubSources.named, 2);
			assert.equal(pubSources.read, 1);
			const pubUnreachable = pubSources.unreachable as ReadonlyArray<Record<string, unknown>>;
			assert.equal(pubUnreachable.length, 1);
			assert.equal(pubUnreachable[0]!.url, PUB_DOWN_URL);
			assert.equal(pubUnreachable[0]!.reason, 'getaddrinfo ENOTFOUND down.statutory.example.org.');
			assert.match(String(pubUnreachable[0]!.retrieved_at), /^\d{4}-\d{2}-\d{2}T/);
			assert.equal(
				(lineages[0]!.notes as string[])[0],
				`1 of 2 sources read; unreachable: ${PUB_DOWN_URL} (getaddrinfo ENOTFOUND down.statutory.example.org.)`
			);
			assert.deepEqual(lineages[1]!.sources, { named: 1, read: 1, unreachable: [] });
			assert.deepEqual(result.sources_unreachable, []);

			const afterFirst = await drafts();
			assert.equal(afterFirst.length, 1, `exactly one draft: ${JSON.stringify(afterFirst)}`);
			const [draft] = afterFirst;
			assert.ok(draft);
			assert.equal(draft.code, 'PUB');
			assert.equal(draft.cloned_from_id, JURISDICTION_ID);
			assert.equal(draft.id, lineages[0]!.draft_id);
			const notes = asRecord(draft.research_notes, 'research_notes');
			assert.equal(notes.proposed_by, 'statutory_drift');
			assert.equal(notes.source_version_id, JURISDICTION_ID);
			const changes = notes.changes as ReadonlyArray<Record<string, unknown>>;
			assert.equal(changes.length, 1);
			assert.deepEqual(
				{
					collection: changes[0]!.collection,
					code: changes[0]!.code,
					field: changes[0]!.field,
					previous: changes[0]!.previous,
					proposed: changes[0]!.proposed,
					source_url: changes[0]!.source_url,
					quote: changes[0]!.quote
				},
				{
					collection: 'contribution_rates',
					code: 'PUB-EPF',
					field: 'bands',
					previous: [sealedBand],
					proposed: [proposedBand],
					source_url: PUB_URL,
					quote: pubQuote
				}
			);
			assert.match(String(changes[0]!.sha256), /^[a-f0-9]{64}$/);
			assert.match(String(changes[0]!.retrieved_at), /^\d{4}-\d{2}-\d{2}T/);
			// The sheet HR reviews names the source the proposal does not stand on.
			const sheetUnreachable = notes.unreachable as ReadonlyArray<Record<string, unknown>>;
			assert.equal(sheetUnreachable.length, 1);
			assert.equal(sheetUnreachable[0]!.url, PUB_DOWN_URL);
			assert.equal(
				sheetUnreachable[0]!.reason,
				'getaddrinfo ENOTFOUND down.statutory.example.org.'
			);
			assert.equal(sheetUnreachable[0]!.retrieved_at, pubUnreachable[0]!.retrieved_at);

			// The draft carries the changed band under the cloned scheme, and the unchanged one as sealed.
			const draftBands = (await session.query(
				`select c.code, r.award from statutory_contributions c join contribution_rates r on r.statutory_contribution_id = c.id where c.settings_id = $1 order by c.code`,
				[draft.id]
			)) as Row[];
			assert.deepEqual(
				draftBands.map((row) => [row.code, (row.award as Record<string, unknown>).employee]),
				[
					['PUB-EPF', 12],
					['PUB-EPF-NC', 5]
				]
			);
			const draftChildren = (await session.query(
				`select (select count(*) from statutory_contributions where settings_id = $1)::int as schemes, (select count(*) from work_catalogue where settings_id = $1)::int as work_catalogue, (select count(*) from leave_catalogue where settings_id = $1)::int as leave_catalogue, (select count(*) from claim_catalogue where settings_id = $1)::int as claim_catalogue, (select count(*) from allowance_catalogue where settings_id = $1)::int as allowance_catalogue, (select count(*) from payment_catalogue where settings_id = $1)::int as payment_catalogue, (select count(*) from loan_catalogue where settings_id = $1)::int as loan_catalogue`,
				[draft.id]
			)) as Row[];
			const sourceChildren = (await session.query(
				`select (select count(*) from statutory_contributions where settings_id = $1)::int as schemes, (select count(*) from work_catalogue where settings_id = $1)::int as work_catalogue, (select count(*) from leave_catalogue where settings_id = $1)::int as leave_catalogue, (select count(*) from claim_catalogue where settings_id = $1)::int as claim_catalogue, (select count(*) from allowance_catalogue where settings_id = $1)::int as allowance_catalogue, (select count(*) from payment_catalogue where settings_id = $1)::int as payment_catalogue, (select count(*) from loan_catalogue where settings_id = $1)::int as loan_catalogue`,
				[JURISDICTION_ID]
			)) as Row[];
			assert.deepEqual(draftChildren, sourceChildren, 'every child row was cloned');

			// Nothing sealed changed: same row versions, same bands.
			const sealedAfter = await session.query(
				`select s.id, s.row_version, r.award from jurisdiction_settings s join statutory_contributions c on c.settings_id = s.id join contribution_rates r on r.statutory_contribution_id = c.id where s.sealed_at is not null order by r.id`
			);
			assert.deepEqual(sealedAfter, sealedBefore);
			const [sealedEpfBand] = (await session.query(
				`select award from contribution_rates where statutory_contribution_id = $1`,
				[STATUTORY_PUB_EPF_ID]
			)) as Row[];
			assert.deepEqual(sealedEpfBand?.award, sealedBand.award);

			// Run 2: the open proposal holds PUB; PUB2 is researched again and still unchanged.
			const second = await start();
			assert.ok(second.status < 300, JSON.stringify(second.value));
			const secondRun = await runOf(asRecord(second.value, 'start').taskId);
			assert.equal(secondRun.status, 'done', JSON.stringify(secondRun));
			const secondLineages = asRecord(secondRun.result, 'second result').lineages as ReadonlyArray<
				Record<string, unknown>
			>;
			assert.deepEqual(
				secondLineages.map((row) => [row.code, row.status, row.draft_id]),
				[
					['PUB', 'proposal_open', draft.id],
					['PUB2', 'unchanged', null]
				]
			);
			assert.equal((await drafts()).length, 1, 'no second draft while the first is open');

			// Run 3: PUB2's research fails; the run reports it by name and the others proceed.
			failPub2 = true;
			const third = await start();
			assert.ok(third.status >= 400, JSON.stringify(third.value));
			assert.match(JSON.stringify(third.value), /PUB2: /, 'the failure names the lineage');
			const failed = (await session.query(
				`select status, error from automation_run where name = 'statutory_drift' and status = 'failed'`
			)) as Row[];
			assert.equal(failed.length, 1, 'the failed run is durable');
			assert.match(String(failed[0]!.error), /PUB2: /);
			assert.equal((await drafts()).length, 1);

			// Run 4: none of PUB2's sources answers. No draft, and the result says which lineage and why.
			failPub2 = false;
			unresolvable.add(PUB2_URL);
			const fourth = await start();
			assert.ok(fourth.status < 300, JSON.stringify(fourth.value));
			const fourthRun = await runOf(asRecord(fourth.value, 'start').taskId);
			assert.equal(fourthRun.status, 'done', JSON.stringify(fourthRun));
			const fourthResult = asRecord(fourthRun.result, 'fourth result');
			assert.deepEqual(fourthResult.sources_unreachable, ['PUB2']);
			const fourthLineages = fourthResult.lineages as ReadonlyArray<Record<string, unknown>>;
			assert.deepEqual(
				fourthLineages.map((row) => [row.code, row.status, row.draft_id]),
				[
					['PUB', 'proposal_open', draft.id],
					['PUB2', 'sources_unreachable', null]
				]
			);
			assert.deepEqual(fourthLineages[1]!.sources, {
				named: 1,
				read: 0,
				unreachable: [
					{
						url: PUB2_URL,
						reason: 'getaddrinfo ENOTFOUND statutory.example.org.',
						retrieved_at: asRecord(
							(fourthLineages[1]!.sources as Record<string, unknown[]>).unreachable[0],
							'PUB2 source'
						).retrieved_at
					}
				]
			});
			assert.match(
				String((fourthLineages[1]!.notes as string[])[0]),
				/^No official page of PUB2 could be read; nothing was researched\. 0 of 1 sources read; unreachable: /
			);
			assert.equal((await drafts()).length, 1, 'no draft from a lineage with no readable source');
		} finally {
			await session.stop();
		}
	}
);
