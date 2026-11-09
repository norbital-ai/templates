// The research pipeline end to end: a scripted model answers, the real automations run over real sealed law from the
// public seed, and the ledger shows what was detected, what was not, and what a person may do with it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import type { Id } from '@norbital-ai/bolt';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { WHOLE_ROW } from '../src/lib/payroll_engine/statutory_change.ts';
import { FAMILIES } from '../src/lib/payroll_engine/statutory_research.ts';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { workspace } from './kit.ts';

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
			settings_code: code,
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
			time_zone: 'Asia/Jakarta',
			entity_extension_data: {},
			status: 'SEALED'
		}
	];
	return rows;
};
const answer = (value: unknown) => ({
	content: JSON.stringify(value),
	toolCalls: [],
	finish: 'stop' as const,
	usage: { input: 0, output: 0 }
});
const found = (...findings: readonly object[]) => answer({ findings, new_sources: [] });
const quiet = found();
const CITATION = 'Permenaker 9/2027';
const OFFICIAL = 'https://jdih.kemnaker.go.id/permenaker-9-2027.pdf';
const finding = (over: object = {}) => ({
	instrument: CITATION,
	title: 'JHT employee rate raised',
	fit: 'VALUE',
	families: ['statutory_contribution_catalog'],
	source_urls: [OFFICIAL],
	source_quote: 'Iuran JHT pekerja menjadi 2,5% mulai 1 Januari 2027.',
	...over
});
const rate = (over: object = {}) => ({
	row_code: 'JHT',
	field_path: 'lookup.employee_rate',
	new_value: 0.025,
	effective_from: '2027-01-01',
	...over
});
const ledger = Effect.fnUntraced(function* (t: Kit) {
	const got = yield* t.storedQuery({
		statutory_finding: { limit: 1000 },
		statutory_change: { limit: 1000 },
		statutory_source: { limit: 1000 },
		jurisdiction_settings: { where: { code: { eq: 'ID' } }, limit: 1000 }
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
	code = 'ID'
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
						hostTools: [
							{
								name: 'web_search',
								description: 'The host search the cassette never calls.',
								input: { type: 'object' },
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
const research = (t: Kit, input: object = { code: 'ID' }) =>
	Effect.andThen(t.as(t.admin).start('statutory_research', input), t.runDue());
const confirm = (t: Kit, target: Id<'statutory_finding'>) =>
	t.as(t.admin).act('statutory_finding.update', [{ target, set: { status: 'CONFIRMED' } }]);
const merge = (t: Kit, target: string) =>
	Effect.gen(function* () {
		yield* t.as(t.admin).start('statutory_materialize', {
			code: 'ID',
			target: PlainDate(target),
			merge: true
		});
		yield* t.runDue();
	});

describe('statutory research', () => {
	it.live('detects a changed rate, files it unconfirmed and dated on the law', () =>
		scenario([found(finding()), answer({ changes: [rate()] })], (t) =>
			Effect.gen(function* () {
				yield* research(t);
				const { findings, changes } = yield* ledger(t);
				assert.equal(findings.length, 1);
				assert.equal(findings[0]?.status, 'PROPOSED');
				assert.equal(findings[0]?.instrument_key, 'permenaker-9-2027');
				assert.equal(changes.length, 1);
				assert.equal(changes[0]?.old_value, 0.02);
				assert.equal(changes[0]?.new_value, 0.025);
				assert.equal(changes[0]?.effective_from, '2027-01-01');
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
				assert.ok(first.sources.some((row) => row.url === 'https://jdih.kemnaker.go.id'));
				t.clock.set('2026-11-12T02:00:00.000Z');
				yield* research(t);
				const second = yield* ledger(t);
				assert.ok(
					second.sources
						.filter((row) => row.status === 'ACTIVE')
						.every((row) => String(row.last_checked_on) === '2026-11-12')
				);
				const prompt = JSON.stringify(t.fakes.ai?.requests.at(-1));
				assert.ok(prompt.includes('jdih.kemnaker.go.id'), 'the next run reads its active sources');
			})
		)
	);

	it.live('never adds a value already in the version it lands on', () =>
		scenario([found(finding()), answer({ changes: [rate({ new_value: 0.02 })] })], (t) =>
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
						instrument: 'PP 12/2027',
						title: 'New housing savings scheme',
						fit: 'ROW',
						source_quote: 'Tabungan perumahan rakyat berlaku 1 Januari 2027.'
					})
				),
				answer({
					changes: [
						{
							row_code: 'TAPERUM',
							field_path: WHOLE_ROW,
							new_value: {
								description: 'Tabungan perumahan rakyat',
								kind: 'CONTRIBUTION',
								depends_on: [],
								subtotal_id: 'BASIC',
								employer_cost_subtotal_id: 'BASIC',
								lookup: { employee_rate: 0.025 },
								eligibility: 'return true;',
								employee_amount: 'return 0;',
								employer_amount: 'return 0;'
							},
							effective_from: '2027-01-01'
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
					yield* merge(t, '2027-01-01');
					const after = yield* ledger(t);
					const sealed = after.versions.find(
						(row) => row.status === 'SEALED' && row.effective_range.from === '2027-01-01'
					);
					assert.ok(sealed, 'the release became a sealed version');
					const row = yield* t.storedQuery({
						statutory_contribution_catalog: {
							where: { settings_id: { eq: sealed.id }, code: { eq: 'TAPERUM' } },
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
					finding({ instrument: 'PP 77/2027', title: 'Family name invented', families: ['visa'] })
				)
			],
			(t) =>
				Effect.gen(function* () {
					yield* research(t);
					const { findings, changes } = yield* ledger(t);
					assert.equal(findings.length, 2);
					assert.ok(findings.every((row) => row.fit === 'STRUCTURAL'));
					assert.equal(changes.length, 0);
					const refused = yield* Effect.flip(confirm(t, first(findings).id));
					assert.match(String(refused), /structural/i);
				})
		)
	);

	it.live('files one finding across scopes, and merges a repeat into its sources', () =>
		scenario(
			[
				found(finding(), finding({ instrument: 'PERMENAKER  9 / 2027', title: 'Again' })),
				answer({ changes: [rate()] }),
				found(finding({ source_urls: [OFFICIAL, 'https://www.bpjsketenagakerjaan.go.id/jht'] }))
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
				const id = first((yield* ledger(t)).findings).id;
				yield* t
					.as(t.admin)
					.act('statutory_finding.update', [{ target: id, set: { status: 'REJECTED' } }]);
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
				found(finding({ instrument: 'Permenaker 10/2027' })),
				answer({ changes: [rate()] })
			],
			(t) =>
				Effect.gen(function* () {
					yield* research(t);
					yield* confirm(t, first((yield* ledger(t)).findings).id);
					yield* merge(t, '2027-01-01');
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
						rate({ new_value: 0.03, effective_from: '2027-07-01' }),
						rate({ new_value: 0.025, effective_from: '2027-01-01' })
					]
				})
			],
			(t) =>
				Effect.gen(function* () {
					yield* research(t);
					const { findings, changes } = yield* ledger(t);
					const later = changes.find((row) => row.effective_from === '2027-07-01');
					assert.equal(later?.old_value, 0.025);
					yield* confirm(t, first(findings).id);
					const early = yield* Effect.flip(
						Effect.andThen(
							t.as(t.admin).start('statutory_materialize', {
								code: 'ID',
								target: PlainDate('2027-07-01'),
								merge: true
							}),
							t.runDue()
						).pipe(Effect.andThen(Effect.fail('ran')))
					);
					assert.notEqual(early, undefined);
					yield* merge(t, '2027-01-01');
					assert.equal((yield* ledger(t)).findings[0]?.status, 'CONFIRMED');
					yield* merge(t, '2027-07-01');
					const after = yield* ledger(t);
					assert.equal(after.findings[0]?.status, 'APPLIED');
					assert.equal(
						after.versions.filter(
							(row) => row.status === 'SEALED' && row.effective_range.from >= '2027'
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
					const unofficial = yield* Effect.flip(confirm(t, first(findings).id));
					assert.match(String(unofficial), /official/);
					yield* t
						.as(t.admin)
						.act('statutory_finding.update', [
							{ target: first(findings).id, set: { source_urls: [OFFICIAL] } }
						]);
					const undated = yield* Effect.flip(confirm(t, first(findings).id));
					assert.match(String(undated), /dated/);
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
								url: 'https://jdih-baru.kemnaker.go.id',
								title: 'New legal portal',
								replaces_url: 'https://jdih.kemnaker.go.id'
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
						yield* t
							.as(t.admin)
							.act('statutory_source.update', [{ target: moved.id, set: { status: 'ACTIVE' } }]);
						yield* research(t);
						const after = yield* ledger(t);
						assert.equal(
							after.sources.find((row) => row.url === 'https://jdih.kemnaker.go.id')?.status,
							'RETIRED'
						);
					})
			)
	);

	it.live('payroll refuses law confirmed but not merged', () =>
		scenario(
			[found(finding()), answer({ changes: [rate({ effective_from: '2026-12-01' })] })],
			(t) =>
				Effect.gen(function* () {
					const run = () =>
						t
							.as(t.admin)
							.act('payroll_run.create', [
								{ entity_id: ENTITY, period: '2026-12', kind: 'ON_CYCLE' }
							]);
					yield* research(t);
					const { findings } = yield* ledger(t);
					yield* confirm(t, first(findings).id);
					const held = yield* Effect.flip(run());
					assert.match(String(held), /Merge the confirmed ID law/);
				})
		)
	);

	it.live('the Saturday cron watches and audits only jurisdictions in use', () =>
		scenario(
			Array.from({ length: FAMILIES.length + 1 }, () => quiet),
			(t) =>
				Effect.gen(function* () {
					t.clock.set('2026-11-07T03:00:00.000Z');
					yield* t.runDue();
					const asked = (t.fakes.ai?.requests ?? []).map((request) => JSON.stringify(request));
					assert.equal(asked.length, FAMILIES.length + 1);
					assert.ok(asked.every((prompt) => prompt.includes('# ID')));
					assert.equal(asked.filter((prompt) => prompt.includes('Audit these rows')).length, 9);
				})
		)
	);

	it.live('a family audit puts every value and its citation before the model', () =>
		scenario([quiet], (t) =>
			Effect.gen(function* () {
				yield* research(t, { code: 'ID', family: 'statutory_contribution_catalog' });
				const prompt = JSON.stringify(t.fakes.ai?.requests[0]);
				assert.ok(prompt.includes('Audit these rows'));
				assert.ok(prompt.includes('foreign_employee_minimum_months'), 'the row values');
				assert.ok(prompt.includes('PP 46/2015'), 'the row citations');
			})
		)
	);
});
