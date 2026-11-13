// The research pipeline end to end: a scripted model answers, the real automation runs over the real law from the
// public seed, and the ledger shows what was detected, what was not, and what a person may do with it. What research
// files is a dated change of the law, in force only while its finding is confirmed.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { JobResult, TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect } from 'effect';
import { lawOn } from '../../src/lib/law.ts';
import { isJsonObject } from '../../src/lib/payroll_engine/foundation.ts';
import { FAMILIES, WHOLE_ROW } from '../../src/lib/payroll_engine/statutory_research.ts';
import { idOf } from '../../src/lib/payroll_engine/reads.ts';
import { lawAt, refusal, seedLaw, storedQuery, storedReader, workspace } from '../kit.ts';

const NOW = '2026-11-05T02:00:00.000Z';
const ENTITY = idOf('entity', '11111111-1111-4111-8111-111111111111');
/** One jurisdiction's public law, as the release's base pack seeds it, and one company under it. */
const law = (code: string) => ({
	...seedLaw(code),
	entity: [{ id: ENTITY, name: 'Entity', settings_code: code }],
	pay_group: [
		{
			id: '11111111-1111-4111-8111-000000000008',
			entity_id: ENTITY,
			name: 'Monthly',
			payment_schedule: {
				frequency: 'MONTHLY',
				business_day: 'PREVIOUS',
				non_working_weekdays: [0, 6],
				short_month: 'LAST_DAY',
				pay_cutoff_day: 1,
				pay_days: [25]
			}
		}
	],
	entity_profile_version: [
		{
			id: '22222222-2222-4222-8222-222222222222',
			entity_id: ENTITY,
			name: 'Entity',
			settings_code: code,
			effective_range: { from: '2025-01-01', to: null },
			time_zone: 'Asia/Kuala_Lumpur',
			entity_extension_data: {},
			status: 'SEALED'
		}
	]
});
/** A value under these keys, wherever one of them is missing. */
const at = (value: unknown, ...path: readonly string[]): unknown =>
	path.reduce<unknown>((held, key) => (isJsonObject(held) ? held[key] : undefined), value);
const EPF = ['statutory_contribution_catalog', 'EPF', 'lookup'] as const;
/** The row's table as the fixture's law holds it today: a change to one value carries the rest of it. */
const HELD_LOOKUP = at(
	lawAt('MY', NOW.slice(0, 10)).rows.statutory_contribution_catalog.find(
		(row) => row.code === 'EPF'
	),
	'lookup'
);
const HELD = at(HELD_LOOKUP, 'employee_rate');
const answer = (value: unknown) => ({
	content: JSON.stringify(value),
	tool_calls: [],
	finish: 'stop' as const,
	usage: { input: 0, output: 0 }
});
const found = (...findings: readonly object[]) => answer({ findings, new_sources: [] });
const quiet = found();
const CITATION = 'Act A2001';
const OFFICIAL = 'https://www.kwsp.gov.my/act-a2001.pdf';
const finding = (over: object = {}) => ({
	instrument: CITATION,
	title: 'Employee rate raised',
	fit: 'VALUE',
	families: ['statutory_contribution_catalog'],
	source_urls: [OFFICIAL],
	source_quote: 'The employee rate becomes 12% from 1 March 2027.',
	...over
});
const rate = (over: object = {}) => ({
	row_code: 'EPF',
	field_path: 'lookup.employee_rate',
	new_value: 0.12,
	effective_from: '2027-03-01',
	...over
});
const ledger = Effect.fnUntraced(function* (t: Kit) {
	const got = yield* storedQuery(t, {
		statutory_finding: { limit: 1000 },
		jurisdiction_change: { where: { finding_id: { is_null: false } }, limit: 1000 },
		statutory_source: { limit: 1000 }
	});
	return {
		findings: got.statutory_finding.rows,
		changes: got.jurisdiction_change.rows.toSorted((left, right) =>
			left.effective_from.localeCompare(right.effective_from)
		),
		sources: got.statutory_source.rows
	};
});
/** The company's law as the workspace holds it on a day. */
const lawOf = (t: Kit, on: string) =>
	lawOn(storedReader(t), [{ entity: ENTITY, on }]).pipe(
		Effect.map(([found]) => {
			assert.ok(found !== undefined, `No law on ${on}`);
			return found;
		})
	);
/** The employee rate the workspace's law holds on a day. */
const rateOn = (t: Kit, on: string) =>
	lawOf(t, on).pipe(
		Effect.map((found) =>
			at(
				found.rows.statutory_contribution_catalog.find((row) => row.code === 'EPF'),
				'lookup',
				'employee_rate'
			)
		)
	);
const scenario = (
	turns: readonly ReturnType<typeof answer>[],
	body: (t: Kit) => Effect.Effect<void, unknown>,
	code = 'MY'
) =>
	Effect.gen(function* () {
		yield* body(yield* TestWorkspace);
	}).pipe(
		Effect.provide(
			workspace({
				seed: law(code),
				now: NOW,
				fakes: { ai: { cassette: { strong: [...turns] } } },
				host: {
					agent: {
						host_tools: [
							{
								name: 'web_search',
								description: 'The host search the cassette never calls.',
								input: { type: 'object' },
								behavior: {},
								call: async () => []
							}
						]
					}
				}
			})
		)
	);
const first = <A>(rows: readonly A[]): A => {
	const row = rows[0];
	if (row === undefined) throw new Error('no row');
	return row;
};
const research = (t: Kit, input: { code: string; family?: string } = { code: 'MY' }) =>
	t.as(t.admin).pipe(
		Effect.andThen((admin) => admin.run('statutory_research', input, JobResult)),
		Effect.andThen(t.run_due())
	);
/** A finding a person decides, at its stored revision. */
const decide = (t: Kit, id: Id<'statutory_finding'>, status: 'CONFIRMED' | 'REJECTED') =>
	Effect.gen(function* () {
		const { statutory_finding } = yield* storedQuery(t, {
			statutory_finding: { where: { id: { eq: id } }, limit: 1 }
		});
		const admin = yield* t.as(t.admin);
		yield* admin.act({
			'statutory_finding.update': [{ target: first(statutory_finding.rows), set: { status } }]
		});
		yield* t.run_due();
	});
const confirm = (t: Kit, id: Id<'statutory_finding'>) => decide(t, id, 'CONFIRMED');

describe('statutory research', () => {
	it.live('detects a changed rate, files it unconfirmed and dated on the law', () =>
		scenario([found(finding()), answer({ changes: [rate()] })], (t) =>
			Effect.gen(function* () {
				yield* research(t);
				const { findings, changes } = yield* ledger(t);
				assert.equal(findings.length, 1);
				assert.equal(findings[0]?.status, 'PROPOSED');
				assert.equal(findings[0]?.instrument_key, 'act-a2001');
				assert.equal(changes.length, 1);
				assert.equal(typeof HELD, 'number');
				assert.notEqual(HELD, 0.12);
				assert.equal(changes[0]?.finding_id, findings[0]?.id);
				assert.equal(changes[0]?.effective_from, '2027-03-01');
				// the patch holds the row's whole table, with the one value changed
				assert.deepEqual(changes[0]?.law, {
					statutory_contribution_catalog: {
						EPF: {
							lookup: { ...(isJsonObject(HELD_LOOKUP) ? HELD_LOOKUP : {}), employee_rate: 0.12 }
						}
					}
				});
				// filed, not in force
				assert.equal(yield* rateOn(t, '2027-03-01'), HELD);
			})
		)
	);

	it.live('finds nothing where nothing changed, and records that it looked', () =>
		scenario([quiet, quiet], (t) =>
			Effect.gen(function* () {
				yield* research(t);
				const first = yield* ledger(t);
				assert.equal(first.findings.length, 0);
				assert.ok(first.sources.some((row) => row.status === 'ACTIVE'));
				assert.ok(first.sources.some((row) => row.url === 'https://www.kwsp.gov.my'));
				t.clock.set('2026-11-12T02:00:00.000Z');
				yield* research(t);
				const second = yield* ledger(t);
				assert.ok(
					second.sources
						.filter((row) => row.status === 'ACTIVE')
						.every((row) => String(row.last_checked_on) === '2026-11-12')
				);
				const prompt = JSON.stringify(t.fakes.ai?.requests.at(-1));
				assert.ok(prompt.includes('www.kwsp.gov.my'), 'the next run reads its active sources');
			})
		)
	);

	it.live('never adds a value the law already holds on its date', () =>
		scenario([found(finding()), answer({ changes: [rate({ new_value: HELD })] })], (t) =>
			Effect.gen(function* () {
				yield* research(t);
				assert.equal((yield* ledger(t)).changes.length, 0);
			})
		)
	);

	it.live(
		'classifies a new scheme into its family; confirmed, the law holds the row from its date',
		() =>
			scenario(
				[
					found(
						finding({
							instrument: 'Act A2003',
							title: 'New savings scheme',
							fit: 'ROW',
							source_quote: 'A savings scheme starts on 1 March 2027.'
						})
					),
					answer({
						changes: [
							{
								row_code: 'NEW_SCHEME',
								field_path: WHOLE_ROW,
								new_value: {
									description: 'A savings scheme',
									kind: 'CONTRIBUTION',
									depends_on: [],
									subtotal: 'BASIC',
									employer_cost_subtotal: 'BASIC',
									lookup: { employee_rate: 0.12 },
									eligibility: 'return true;',
									employee_amount: 'return 0;',
									employer_amount: 'return 0;'
								},
								effective_from: '2027-03-01'
							}
						]
					})
				],
				(t) =>
					Effect.gen(function* () {
						const scheme = (on: string) =>
							lawOf(t, on).pipe(
								Effect.map((found) =>
									found.rows.statutory_contribution_catalog.find((row) => row.code === 'NEW_SCHEME')
								)
							);
						yield* research(t);
						const before = yield* ledger(t);
						const id = first(before.findings).id;
						assert.equal(before.findings[0]?.fit, 'ROW');
						assert.deepEqual(before.findings[0]?.families, ['statutory_contribution_catalog']);
						assert.equal(yield* scheme('2027-03-01'), undefined);
						yield* confirm(t, id);
						const row = yield* scheme('2027-03-01');
						assert.ok(row !== undefined, 'the law holds the new row');
						// a row names its subtotal by code
						assert.equal(row.subtotal, 'BASIC');
						assert.equal(yield* scheme('2027-02-28'), undefined);
						assert.equal((yield* ledger(t)).findings[0]?.status, 'CONFIRMED');
					})
			)
	);

	it.live('keeps what no family can hold out of the ledger of changes', () =>
		scenario(
			[
				found(
					finding({ title: 'Portable severance account', fit: 'STRUCTURAL', families: [] }),
					finding({ instrument: 'Act A2004', title: 'Family name invented', families: ['visa'] })
				)
			],
			(t) =>
				Effect.gen(function* () {
					yield* research(t);
					const { findings, changes } = yield* ledger(t);
					assert.equal(findings.length, 2);
					assert.ok(findings.every((row) => row.fit === 'STRUCTURAL'));
					assert.equal(changes.length, 0);
					const refused = yield* refusal(confirm(t, first(findings).id));
					assert.equal(refused.key, 'errors.statutory_finding_structural');
				})
		)
	);

	it.live('files one finding across scopes, and merges a repeat into its sources', () =>
		scenario(
			[
				found(finding(), finding({ instrument: 'ACT  A2001', title: 'Again' })),
				answer({ changes: [rate()] }),
				found(finding({ source_urls: [OFFICIAL, 'https://www.perkeso.gov.my/rates'] }))
			],
			(t) =>
				Effect.gen(function* () {
					yield* research(t);
					yield* research(t);
					const { findings, changes } = yield* ledger(t);
					assert.equal(findings.length, 1);
					assert.equal(changes.length, 1);
					assert.equal((findings[0]?.source_urls as readonly string[]).length, 2);
				})
		)
	);

	it.live('never proposes again what a person rejected', () =>
		scenario([found(finding()), answer({ changes: [rate()] }), found(finding())], (t) =>
			Effect.gen(function* () {
				yield* research(t);
				const found = first((yield* ledger(t)).findings);
				yield* (yield* t.as(t.admin)).act({
					'statutory_finding.update': [{ target: found, set: { status: 'REJECTED' } }]
				});
				yield* research(t);
				const { findings, changes } = yield* ledger(t);
				assert.equal(findings.length, 1);
				assert.equal(findings[0]?.status, 'REJECTED');
				assert.equal(changes.length, 1);
			})
		)
	);

	it.live('never re-files law already in force from a future date', () =>
		scenario(
			[
				found(finding()),
				answer({ changes: [rate()] }),
				found(finding({ instrument: 'Act A2002' })),
				answer({ changes: [rate()] })
			],
			(t) =>
				Effect.gen(function* () {
					yield* research(t);
					yield* confirm(t, first((yield* ledger(t)).findings).id);
					yield* research(t);
					const { findings, changes } = yield* ledger(t);
					assert.equal(findings.length, 2);
					assert.equal(changes.length, 1, 'the law already holds it from 2027-03-01');
				})
		)
	);

	it.live(
		'chains a staged law: each step is its own change, and confirming the finding puts them all in force, each from its date',
		() =>
			scenario(
				[
					found(finding()),
					answer({
						changes: [
							rate({ new_value: 0.13, effective_from: '2027-07-01' }),
							rate({ new_value: 0.12, effective_from: '2027-03-01' })
						]
					})
				],
				(t) =>
					Effect.gen(function* () {
						yield* research(t);
						const { findings, changes } = yield* ledger(t);
						assert.deepEqual(
							changes.map((row) => [
								row.finding_id,
								row.effective_from,
								at(row.law, ...EPF, 'employee_rate')
							]),
							[
								[first(findings).id, '2027-03-01', 0.12],
								[first(findings).id, '2027-07-01', 0.13]
							]
						);
						assert.equal(yield* rateOn(t, '2027-07-01'), HELD);
						yield* confirm(t, first(findings).id);
						assert.equal(yield* rateOn(t, '2027-02-28'), HELD);
						assert.equal(yield* rateOn(t, '2027-03-01'), 0.12);
						assert.equal(yield* rateOn(t, '2027-06-30'), 0.12);
						assert.equal(yield* rateOn(t, '2027-07-01'), 0.13);
					})
			)
	);

	it.live(
		'refuses to confirm without an official source, or with no change drafted: an undated one is noted for a person to date',
		() =>
			scenario(
				[
					found(finding({ source_urls: ['https://example.com/news'] })),
					answer({ changes: [rate({ effective_from: null })] })
				],
				(t) =>
					Effect.gen(function* () {
						yield* research(t);
						const { findings, changes } = yield* ledger(t);
						assert.deepEqual(changes, []);
						assert.match(String(first(findings).notes), /Undated/);
						const unofficial = yield* refusal(confirm(t, first(findings).id));
						assert.equal(unofficial.key, 'errors.statutory_finding_official_source');
						yield* (yield* t.as(t.admin)).act({
							'statutory_finding.update': [
								{ target: first(findings), set: { source_urls: [OFFICIAL] } }
							]
						});
						const undrafted = yield* refusal(confirm(t, first(findings).id));
						assert.equal(undrafted.key, 'errors.statutory_finding_changes_drafted');
					})
			)
	);

	it.live(
		'only a person activates what research proposes, and a moved source retires the old',
		() =>
			scenario(
				[
					answer({
						findings: [],
						new_sources: [
							{
								url: 'https://www2.kwsp.gov.my',
								title: 'New legal portal',
								replaces_url: 'https://www.kwsp.gov.my'
							}
						]
					}),
					quiet
				],
				(t) =>
					Effect.gen(function* () {
						yield* research(t);
						const before = yield* ledger(t);
						const moved = first(before.sources.filter((row) => row.origin === 'AGENT'));
						assert.equal(moved.status, 'PROPOSED');
						yield* (yield* t.as(t.admin)).act({
							'statutory_source.update': [{ target: moved, set: { status: 'ACTIVE' } }]
						});
						yield* research(t);
						const after = yield* ledger(t);
						assert.equal(
							after.sources.find((row) => row.url === 'https://www.kwsp.gov.my')?.status,
							'RETIRED'
						);
					})
			)
	);

	it.live(
		'a filed change is out of force until its finding is confirmed, and out again once it is rejected',
		() =>
			scenario([found(finding()), answer({ changes: [rate()] })], (t) =>
				Effect.gen(function* () {
					yield* research(t);
					const { id } = first((yield* ledger(t)).findings);
					assert.equal(yield* rateOn(t, '2027-03-01'), HELD);
					yield* confirm(t, id);
					assert.equal(yield* rateOn(t, '2027-03-01'), 0.12);
					assert.equal(yield* rateOn(t, '2027-02-28'), HELD, 'from its date, not before');
					yield* decide(t, id, 'REJECTED');
					assert.equal(yield* rateOn(t, '2027-03-01'), HELD);
					assert.equal((yield* ledger(t)).changes.length, 1, 'the change stays on file');
				})
			)
	);

	it.live('the Saturday cron watches and audits only jurisdictions in use', () =>
		scenario(
			Array.from({ length: FAMILIES.length + 1 }, () => quiet),
			(t) =>
				Effect.gen(function* () {
					t.clock.set('2026-11-07T03:00:00.000Z');
					yield* t.run_due();
					const asked = (t.fakes.ai?.requests ?? []).map((request) => JSON.stringify(request));
					assert.equal(asked.length, FAMILIES.length + 1);
					assert.ok(asked.every((prompt) => prompt.includes('# MY')));
					assert.equal(
						asked.filter((prompt) => prompt.includes('Audit these rows')).length,
						FAMILIES.length
					);
				})
		)
	);

	it.live('a family audit puts every value and its citation before the model', () =>
		scenario([quiet], (t) =>
			Effect.gen(function* () {
				yield* research(t, { code: 'MY', family: 'statutory_contribution_catalog' });
				const prompt = JSON.stringify(t.fakes.ai?.requests[0]);
				assert.ok(prompt.includes('Audit these rows'));
				assert.ok(prompt.includes('new_entrant_senior_age'), 'the row values');
				assert.ok(prompt.includes('Act 452'), 'the row citations');
			})
		)
	);
});
