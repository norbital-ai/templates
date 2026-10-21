import { readSeedRows } from './seed_values.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from '@effect/vitest';
import { vi } from 'vitest';
import { Context, Effect, Layer, Schema } from 'effect';
import { Reads, WebRead, type AiResponse, type HostTool } from '@norbital-ai/bolt/engine';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import type { DeclaredRow, Page } from '@norbital-ai/bolt';
import { SNAPSHOT_MODELS } from '../src/lib/payroll_engine/statutory_snapshot.ts';
import { nativeId } from './fixture_values.ts';
import { workspace } from './kit.ts';

const root = path.resolve(import.meta.dirname, '../seed/jurisdiction');
const tables = [
	'adhoc_catalog',
	'allowance_catalog',
	'claim_catalog',
	'leave_catalog',
	'loan_catalog',
	'work_catalog',
	'statutory_contribution_catalog',
	'rule_set'
] as const;
const Settings = Schema.Struct({
	id: Schema.String,
	effective_range: Schema.Struct({
		from: Schema.String,
		to: Schema.optionalKey(Schema.NullOr(Schema.String))
	}),
	sources: Schema.Struct({ entries: Schema.Array(Schema.Struct({ url: Schema.String })) })
});
const Index = Schema.Struct({ sections: Schema.Record(Schema.String, Schema.Unknown) });
const RuleIndex = Schema.Struct({ rows: Schema.Array(Schema.Struct({ code: Schema.String })) });
const NavigateInput = Schema.Struct({
	url: Schema.optionalKey(Schema.String),
	go: Schema.optionalKey(Schema.Literals(['back', 'forward', 'reload'])),
	find: Schema.optionalKey(Schema.String)
}).annotate({ parseOptions: { onExcessProperty: 'error' } });
const SnapshotInput = Schema.Struct({
	find: Schema.optionalKey(Schema.String),
	from: Schema.optionalKey(Schema.Finite)
}).annotate({ parseOptions: { onExcessProperty: 'error' } });
const BrowserStep = Schema.Union([
	Schema.Struct({ click: Schema.String }),
	Schema.Struct({
		type: Schema.Struct({
			ref: Schema.String,
			text: Schema.String,
			submit: Schema.optionalKey(Schema.Boolean)
		})
	}),
	Schema.Struct({ select: Schema.Struct({ ref: Schema.String, value: Schema.String }) }),
	Schema.Struct({ press: Schema.String }),
	Schema.Struct({ hover: Schema.String }),
	Schema.Struct({
		scroll: Schema.Struct({
			ref: Schema.optionalKey(Schema.String),
			y: Schema.optionalKey(Schema.Finite)
		})
	}),
	Schema.Struct({
		wait: Schema.Struct({
			text: Schema.optionalKey(Schema.String),
			ms: Schema.optionalKey(Schema.Finite)
		})
	})
]).annotate({ parseOptions: { onExcessProperty: 'error' } });
const ActInput = Schema.Struct({
	steps: Schema.Array(BrowserStep).check(Schema.isMinLength(1), Schema.isMaxLength(20))
}).annotate({ parseOptions: { onExcessProperty: 'error' } });
const BrowserPage = Schema.Struct({
	url: Schema.String,
	title: Schema.String,
	page: Schema.String,
	lines: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	next: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))
});
const toolInput = (schema: Schema.Top) => {
	const document = Schema.toJsonSchemaDocument(schema);
	return Schema.decodeUnknownSync(Schema.Json)({ ...document.schema, $defs: document.definitions });
};

describe('statutory drift research transport (mock inference, not live research)', () => {
	for (const code of fs.readdirSync(root))
		it.effect(`${code}: one inference saves the complete corrected draft`, () =>
			Effect.gen(function* () {
				let folder = '';
				for (const name of fs.readdirSync(path.join(root, code))) {
					if (!/^version_\d+$/.test(name)) continue;
					const current = path.join(root, code, name);
					const row = Schema.decodeUnknownSync(Settings)(
						readSeedRows(current, 'jurisdiction_settings')[0]
					);
					if (
						row.effective_range.from <= '2026-10-10' &&
						(row.effective_range.to == null || row.effective_range.to >= '2026-10-10')
					)
						folder = current;
				}
				assert.ok(folder);
				const settingsRows = readSeedRows(folder, 'jurisdiction_settings');
				const version = Schema.decodeUnknownSync(Settings)(settingsRows[0]);
				// A real successor keeps its authored predecessor chain in the same seeded lineage.
				const lineageRows = fs
					.readdirSync(path.join(root, code))
					.filter((name) => /^version_\d+$/.test(name))
					.flatMap((name) => readSeedRows(path.join(root, code, name), 'jurisdiction_settings'));
				const seededSettings = [...settingsRows];
				for (const current of seededSettings) {
					const previous = Schema.decodeUnknownSync(Schema.NullOr(Schema.String))(
						current['cloned_from_id'] ?? null
					);
					if (previous === null) continue;
					const parentId = nativeId('jurisdiction_settings', previous);
					if (seededSettings.some((row) => row['id'] === parentId)) continue;
					const parent = lineageRows.find((row) => row['id'] === parentId);
					assert.ok(parent, `${code}: the authored predecessor ${parentId} exists`);
					seededSettings.push(parent);
				}
				seededSettings.reverse();
				const rows = {
					adhoc_catalog: readSeedRows(folder, 'adhoc_catalog'),
					allowance_catalog: readSeedRows(folder, 'allowance_catalog'),
					claim_catalog: readSeedRows(folder, 'claim_catalog'),
					leave_catalog: readSeedRows(folder, 'leave_catalog'),
					loan_catalog: readSeedRows(folder, 'loan_catalog'),
					work_catalog: readSeedRows(folder, 'work_catalog'),
					statutory_contribution_catalog: readSeedRows(folder, 'statutory_contribution_catalog'),
					rule_set: readSeedRows(folder, 'rule_set')
				};
				const missing = rows.rule_set.find((row) => row['code'] === 'record_retention');
				assert.ok(missing);
				rows['rule_set'] = rows['rule_set'].filter((row) => row !== missing);
				const restored = Object.fromEntries(
					Object.entries(missing).filter(([key]) => key in SNAPSHOT_MODELS.rule_set.fields)
				);
				const source = version.sources.entries[0];
				assert.ok(source);
				const url = new URL('/probe-instrument', source.url).href;
				const quote = 'Payroll records must be kept for the statutory retention period.';
				const browserRequests: { name: string; input: Schema.Json }[] = [];
				const browserPages: string[] = [];
				let openedUrl: string | undefined;
				const snapshot = (find?: string, from = 1) => {
					assert.ok(openedUrl, 'The browser fixture navigates before reading its page.');
					const lines = ['# Official instrument fixture', quote];
					const words = (find ?? '').toLowerCase().split(/\s+/).filter(Boolean);
					const shown = lines.flatMap((line, index) => {
						const number = index + 1;
						if (number < from) return [];
						if (words.length > 0 && !words.some((word) => line.toLowerCase().includes(word)))
							return [];
						return [words.length === 0 ? line : `${number}: ${line}`];
					});
					const page = Schema.decodeUnknownSync(BrowserPage)({
						url: openedUrl,
						title: 'Official instrument fixture',
						page: shown.join('\n'),
						lines: lines.length
					});
					browserPages.push(page.page);
					return Schema.decodeUnknownSync(Schema.Json)(page);
				};
				const browserTools: readonly HostTool[] = [
					{
						name: 'web_search',
						description: 'Search the web; this fixture expects no searches.',
						input: { type: 'object' },
						async call() {
							assert.fail('The fixture research reads the cited instrument without searching.');
						}
					},
					{
						name: 'browser_navigate',
						description: 'Open the official instrument fixture and answer its page text.',
						input: toolInput(NavigateInput),
						async call(input, _context, signal) {
							signal.throwIfAborted();
							browserRequests.push({ name: 'browser_navigate', input });
							const wanted = Schema.decodeUnknownSync(NavigateInput)(input);
							assert.equal(wanted.go, undefined, 'The fixture has no browser history.');
							assert.equal(wanted.url, url, 'Only the cited official instrument may be opened.');
							openedUrl = Schema.decodeUnknownSync(Schema.String)(wanted.url);
							return snapshot(wanted.find);
						}
					},
					{
						name: 'browser_snapshot',
						description: 'Read the open official instrument fixture as page text.',
						readOnly: true,
						input: toolInput(SnapshotInput),
						async call(input, _context, signal) {
							signal.throwIfAborted();
							browserRequests.push({ name: 'browser_snapshot', input });
							const wanted = Schema.decodeUnknownSync(SnapshotInput)(input);
							return snapshot(wanted.find, wanted.from);
						}
					},
					{
						name: 'browser_act',
						description:
							'Validate browser actions; this official instrument fixture permits no edits.',
						input: toolInput(ActInput),
						async call(input, _context, signal) {
							signal.throwIfAborted();
							browserRequests.push({ name: 'browser_act', input });
							Schema.decodeUnknownSync(ActInput)(input);
							assert.fail('The official instrument fixture expects no browser actions.');
						}
					}
				];
				const response: AiResponse = {
					content: '',
					toolCalls: [
						{ id: 'navigate', name: 'browser_navigate', input: { url } },
						{ id: 'snapshot', name: 'browser_snapshot', input: {} },
						{
							id: 'restore',
							name: 'patch',
							input: {
								ops: [
									{ op: 'add', path: '/snapshot/rule_set/-', value: restored },
									{ op: 'replace', path: '/changed', value: true },
									{
										op: 'replace',
										path: '/summary',
										value: 'Restore the omitted statutory retention rule.'
									},
									{
										op: 'replace',
										path: '/quotes',
										value: [
											{ url, quote, paths: [`/snapshot/rule_set/${rows['rule_set'].length}`] }
										]
									}
								]
							}
						},
						{ id: 'save', name: 'submit', input: {} }
					],
					finish: 'tool',
					usage: { input: 1, output: 1 }
				};
				const context = yield* Layer.build(
					workspace({
						now: '2026-10-10T00:00:00Z',
						seed: { jurisdiction_settings: seededSettings, ...rows },
						fakes: { ai: { cassette: { strong: [response] } } },
						host: { agent: { hostTools: browserTools } },
						ports: Layer.succeed(WebRead, {
							read: (wanted) =>
								Effect.sync(() => {
									assert.equal(
										wanted,
										url,
										'Quote verification reads the cited official instrument.'
									);
									return { url: wanted, title: 'Official instrument fixture', text: quote };
								})
						})
					})
				);
				const t = Context.get(context, TestWorkspace);
				const reads = Context.get(context, Reads);
				const run = reads.run;
				const observed = new Set<string>();
				const spy = vi.spyOn(reads, 'run').mockImplementation((batch, reader, bindings) => {
					if (reader.as === 'caller')
						for (const member of batch) {
							if (member.kind !== 'read') continue;
							const selected = member.select.fields ?? [];
							if (member.collection === 'jurisdiction_settings' && selected.includes('payroll'))
								assert.ok(selected.includes('suspension_kinds'));
							const spec = Object.entries(SNAPSHOT_MODELS).find(
								([name]) => name === member.collection
							)?.[1];
							if (spec === undefined) continue;
							observed.add(member.collection);
							for (const key of Object.keys(spec.fields))
								assert.ok(selected.includes(key), `${member.collection}.${key}`);
						}
					return run(batch, reader, bindings);
				});
				const runId = yield* Effect.gen(function* () {
					const started = yield* t.as(t.admin).start('statutory_drift', { code });
					assert.equal(started.kind, 'committed');
					if (started.kind !== 'committed')
						assert.fail('The administrator starts the research run.');
					const output = Schema.decodeUnknownSync(
						Schema.Struct({ id: Schema.String, automation: Schema.Literal('statutory_drift') })
					)(started.output);
					yield* t.runDue();
					return output.id;
				}).pipe(Effect.ensuring(Effect.sync(() => spy.mockRestore())));
				const [completed] = yield* t.db.rows(
					Schema.Struct({
						state: Schema.String,
						output: Schema.Json,
						error: Schema.NullOr(Schema.Json)
					}),
					{
						text: 'SELECT state, output, error FROM sys_run WHERE id = $1',
						params: [runId]
					}
				);
				assert.ok(completed);
				assert.equal(completed.state, 'succeeded', JSON.stringify(completed.error));
				assert.deepEqual(completed.output, { lineages: [code], drafted: [code], failed: [] });
				const ai = t.fakes.ai;
				assert.ok(ai);
				assert.equal(ai.requests.length, 1);
				assert.deepEqual(
					browserRequests.map((request) => request.name),
					['browser_navigate', 'browser_snapshot']
				);
				assert.equal(openedUrl, url);
				assert.deepEqual(browserPages, [
					`# Official instrument fixture\n${quote}`,
					`# Official instrument fixture\n${quote}`
				]);
				const request = ai.requests[0];
				assert.ok(request);
				const marker = 'Complete snapshot index (read original values in memory):\n';
				const prompt = request.messages.find(
					(message) => typeof message.content === 'string' && message.content.includes(marker)
				);
				assert.ok(prompt);
				const content = Schema.decodeUnknownSync(Schema.String)(prompt.content);
				const index = Schema.decodeUnknownSync(Schema.fromJsonString(Index))(
					content.slice(content.indexOf(marker) + marker.length).split('\n', 1)[0]
				);
				assert.deepEqual(Object.keys(index.sections).sort(), Object.keys(SNAPSHOT_MODELS).sort());
				assert.equal(
					Schema.decodeUnknownSync(RuleIndex)(index.sections['rule_set']).rows.some(
						(row) => row.code === missing['code']
					),
					false
				);
				const { rows: drafts } = yield* t.as(t.admin).read('jurisdiction_settings', {
					where: { cloned_from_id: { eq: nativeId('jurisdiction_settings', version.id) } },
					select: { id: true, sealed_at: true, cloned_from_id: true, suspension_kinds: true },
					all: true
				});
				const created = drafts[0];
				assert.ok(created);
				assert.equal(created.sealed_at, null);
				assert.equal(created.cloned_from_id, version.id);
				assert.deepEqual(created.suspension_kinds, readSeedRows(folder, 'suspension_kind'));
				assert.equal('suspension_kind' in created, false);
				for (const name of tables) {
					assert.ok(observed.has(name), `The native body read ${name}.`);
					const children: Page<DeclaredRow<typeof name>> = yield* t.as(t.admin).read(name, {
						mode: 'declared',
						where: { settings_id: { eq: created.id } },
						select: ['code'],
						all: true
					});
					assert.equal(children.rows.length, rows[name].length + (name === 'rule_set' ? 1 : 0));
					for (const row of rows[name])
						assert.ok(children.rows.some((child) => child['code'] === row['code']));
				}
			})
		);
});
