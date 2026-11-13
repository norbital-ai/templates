// The research pipeline end to end: a scripted model answers, the real automations run over real sealed law from the
// public seed, and the ledger shows what was detected, what was not, and what a person may do with it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { JobResult, TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { plain_date } from '../../src/lib/date.ts';
import { Effect } from 'effect';
import { WHOLE_ROW } from '../../src/lib/payroll_engine/statutory_change.ts';
import { FAMILIES } from '../../src/lib/payroll_engine/statutory_research.ts';
import type { JsonObject } from '../../src/lib/payroll_engine/contracts.ts';
import { idOf, objectValue } from '../../src/lib/payroll_engine/reads.ts';
import { workspace, storedQuery, refusal } from '../kit.ts';

const NOW = '2026-11-05T02:00:00.000Z';
const ENTITY = idOf('entity', '11111111-1111-4111-8111-111111111111');
type Row = JsonObject;
/** One jurisdiction's public law, as the release's base pack seeds it. */
const law = (code: string) => {
	const rows: { [model: string]: Row[] } = {
		entity: [{ id: ENTITY, code: 'E1', name: 'Entity', settings_code: code }]
	};
	const root = join(process.cwd(), 'seed/public/jurisdiction', code);
	for (const version of readdirSync(root))
		for (const file of readdirSync(join(root, version))) {
			const model = file.replace('.json', '');
			const list: Row | Row[] = JSON.parse(readFileSync(join(root, version, file), 'utf8'));
			(rows[model] ??= []).push(...(Array.isArray(list) ? list : [list]));
		}
	rows.entity = [
		{
			id: ENTITY,
			name: 'Entity',
			settings_code: code
		}
	];
	rows.pay_group = [
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
	];
	rows.entity_profile_version = [
		{
			id: '22222222-2222-4222-8222-222222222222',
			entity_id: ENTITY,
			name: 'Entity',
			settings_code: code,
			input_schema_version_id: rows.jurisdiction_settings?.[0]?.id ?? null,
			effective_range: { from: '2025-01-01', to: null },
			time_zone: 'Asia/Kuala_Lumpur',
			entity_extension_data: {},
			status: 'SEALED'
		}
	];
	return rows;
};
const answer = (value: unknown) => ({
	content: JSON.stringify(value),
	tool_calls: [],
	finish: 'stop' as const,
	usage: { input: 0, output: 0 }
});
const found = (...findings: readonly object[]) => answer({ findings, new_sources: [] });
const quiet = found();
/** The rate the fixture's law holds today: research reports it as the old value, whatever it is. */
const HELD = objectValue(
	law('MY').statutory_contribution_catalog?.findLast((row) => row.code === 'EPF')?.lookup
).employee_rate;
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
		statutory_change: { limit: 1000 },
		statutory_source: { limit: 1000 },
		jurisdiction_settings: { where: { code: { eq: 'MY' } }, limit: 1000 }
	});
	return {
		findings: got.statutory_finding.rows,
		changes: got.statutory_change.rows,
		sources: got.statutory_source.rows,
		versions: got.jurisdiction_settings.rows
	};
});
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
/** A finding confirmed by an admin, at its stored revision. */
const confirm = (t: Kit, id: Id<'statutory_finding'>) =>
	Effect.gen(function* () {
		const { statutory_finding } = yield* storedQuery(t, {
			statutory_finding: { where: { id: { eq: id } }, limit: 1 }
		});
		const admin = yield* t.as(t.admin);
		return yield* admin.act({
			'statutory_finding.update': [
				{ target: first(statutory_finding.rows), set: { status: 'CONFIRMED' } }
			]
		});
	});
const materialize = (t: Kit, target: string) =>
	t
		.as(t.admin)
		.pipe(
			Effect.andThen((admin) =>
				admin.run(
					'statutory_materialize',
					{ code: 'MY', target: plain_date(target), merge: true },
					JobResult
				)
			)
		);
const merge = (t: Kit, target: string) =>
	Effect.gen(function* () {
		yield* materialize(t, target);
		yield* t.run_due();
	});

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
				assert.equal(changes[0]?.old_value, HELD);
				assert.equal(changes[0]?.new_value, 0.12);
				assert.equal(changes[0]?.effective_from, '2027-03-01');
				assert.equal(changes[0]?.family, 'statutory_contribution_catalog');
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

	it.live('never adds a value already in the version it lands on', () =>
		scenario([found(finding()), answer({ changes: [rate({ new_value: HELD })] })], (t) =>
			Effect.gen(function* () {
				yield* research(t);
				assert.equal((yield* ledger(t)).changes.length, 0);
			})
		)
	);

	it.live('classifies a new scheme into its family and merges it into a new version', () =>
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
								subtotal_id: 'BASIC',
								employer_cost_subtotal_id: 'BASIC',
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
					yield* research(t);
					const before = yield* ledger(t);
					const id = first(before.findings).id;
					assert.equal(before.findings[0]?.fit, 'ROW');
					assert.deepEqual(before.findings[0]?.families, ['statutory_contribution_catalog']);
					yield* confirm(t, id);
					yield* merge(t, '2027-03-01');
					const after = yield* ledger(t);
					const sealed = after.versions.find(
						(row) => row.status === 'SEALED' && row.effective_range.from === '2027-03-01'
					);
					assert.ok(sealed, 'the release became a sealed version');
					const row = yield* storedQuery(t, {
						statutory_contribution_catalog: {
							where: { settings_id: { eq: sealed.id }, code: { eq: 'NEW_SCHEME' } },
							limit: 1
						},
						subtotal: {
							where: { settings_id: { eq: sealed.id }, code: { eq: 'BASIC' } },
							limit: 1
						}
					});
					assert.equal(
						row.statutory_contribution_catalog.rows[0]?.subtotal_id,
						row.subtotal.rows[0]?.id
					);
					assert.equal(after.findings[0]?.status, 'APPLIED');
					assert.equal(after.changes[0]?.applied_version_id, sealed.id);
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

	it.live('never re-files law applied for a future date', () =>
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
					yield* merge(t, '2027-03-01');
					yield* research(t);
					const { findings, changes } = yield* ledger(t);
					assert.equal(findings.length, 2);
					assert.equal(changes.length, 1, 'the sealed 2027 version already holds it');
				})
		)
	);

	it.live('chains a staged law and merges its releases in order', () =>
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
					const later = changes.find((row) => row.effective_from === '2027-07-01');
					assert.equal(later?.old_value, 0.12);
					yield* confirm(t, first(findings).id);
					// the later release first: refused by its reason, whether the start or its run answers it
					const early = yield* Effect.andThen(materialize(t, '2027-07-01'), t.run_due()).pipe(
						Effect.match({
							onFailure: String,
							onSuccess: ({ failed }) => failed.map((run) => String(run.error)).join('\n')
						})
					);
					assert.match(early, /out_of_order: merge the 2027-03-01 release before 2027-07-01/);
					assert.equal(
						(yield* ledger(t)).versions.filter((row) => row.effective_range.from > '2027-01-01')
							.length,
						0
					);
					yield* merge(t, '2027-03-01');
					assert.equal((yield* ledger(t)).findings[0]?.status, 'CONFIRMED');
					yield* merge(t, '2027-07-01');
					const after = yield* ledger(t);
					assert.equal(after.findings[0]?.status, 'APPLIED');
					assert.equal(
						after.versions.filter(
							(row) => row.status === 'SEALED' && row.effective_range.from > '2027-01-01'
						).length,
						2
					);
				})
		)
	);

	it.live('refuses to confirm without an official source, an undated change or no changes', () =>
		scenario(
			[
				found(finding({ source_urls: ['https://example.com/news'] })),
				answer({ changes: [rate({ effective_from: null })] })
			],
			(t) =>
				Effect.gen(function* () {
					yield* research(t);
					const { findings } = yield* ledger(t);
					const unofficial = yield* refusal(confirm(t, first(findings).id));
					assert.equal(unofficial.key, 'errors.statutory_finding_official_source');
					yield* (yield* t.as(t.admin)).act({
						'statutory_finding.update': [
							{ target: first(findings), set: { source_urls: [OFFICIAL] } }
						]
					});
					const undated = yield* refusal(confirm(t, first(findings).id));
					assert.equal(undated.key, 'errors.statutory_finding_changes_dated');
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

	it.live('payroll refuses law confirmed but not merged', () =>
		scenario(
			// inside the sealed window: past it the run is refused for having no law at all
			[found(finding()), answer({ changes: [rate({ effective_from: '2026-11-01' })] })],
			(t) =>
				Effect.gen(function* () {
					const run = () =>
						t.as(t.admin).pipe(
							Effect.andThen((admin) =>
								admin.act({
									'payroll_run.create': [{ entity_id: ENTITY, period: '2026-11', kind: 'ON_CYCLE' }]
								})
							)
						);
					yield* research(t);
					const { findings } = yield* ledger(t);
					yield* confirm(t, first(findings).id);
					const held = yield* refusal(run());
					assert.equal(held.key, 'errors.payroll_run_merge_law');
					assert.deepEqual(held.values, { code: 'MY', date: '2026-11-01' });
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
