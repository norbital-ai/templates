import { readSeedRows } from './seed_values.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from '@effect/vitest';
import { vi } from 'vitest';
import { Context, Effect, Layer, Schema } from 'effect';
import { Browser, Reads, WebRead, type AiResponse, type HostTool } from '@norbital-ai/bolt/engine';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import type { DeclaredRow, Page } from '@norbital-ai/bolt';
import { SNAPSHOT_MODELS } from '../src/lib/payroll_engine/statutory_snapshot.ts';
import { RESEARCH_AGENT_NAMES, RULE_FAMILIES } from '../src/lib/payroll_engine/research_agents.ts';
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
	sources: Schema.Struct({
		entries: Schema.Array(Schema.Struct({ agent: Schema.String, url: Schema.String }))
	})
});
const Index = Schema.Struct({ sections: Schema.Record(Schema.String, Schema.Unknown) });
const RuleIndex = Schema.Struct({
	rows: Schema.Array(Schema.Struct({ code: Schema.String, path: Schema.String }))
});
const RunOutput = Schema.Struct({
	lineages: Schema.Array(Schema.String),
	drafted: Schema.Array(Schema.String),
	refused: Schema.Array(Schema.String),
	failed: Schema.Array(Schema.String)
});
const BrowserPage = Schema.Struct({
	url: Schema.String,
	title: Schema.String,
	page: Schema.String,
	lines: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	next: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)))
});
const quote = 'Payroll records must be kept for the statutory retention period.';
const summary = 'Restore the omitted statutory retention rule.';
type ToolCalls = AiResponse['toolCalls'];

/** The seeded lineage governing 2026-10-10, with its retention rule withheld for research to restore. */
function lineage(code: string) {
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
	// record_retention is a PAYROLL rule: the rules agent's own, read from its own sources
	const source = version.sources.entries.find((entry) => entry.agent === 'rules');
	assert.ok(source);
	const url = new URL('/probe-instrument', source.url).href;
	return { folder, settingsRows, version, seededSettings, rows, missing, restored, source, url };
}

/** Resolve an agent's coverage through its keyed path. */
const cover = (agent: string) => ({ path: `/coverage/${agent}/status`, set: 'verified' });
/** An agent that finds nothing to change: it resolves its coverage and submits unchanged. */
const idle = (agent: string): ToolCalls => [
	{ id: 'cover', name: 'edit', input: { ops: [cover(agent)] } },
	{ id: 'save', name: 'submit', input: {} }
];
/** One model turn per agent, in the order the six start; the rules agent (record_retention's owner) answers `turn`. */
const passes = (turn: ToolCalls): ToolCalls[] =>
	RESEARCH_AGENT_NAMES.map((agent) => (agent === 'rules' ? turn : idle(agent)));
/** Add the withheld retention rule at its keyed path, citing `reference` in its own references (none when null). */
const restore = (
	restored: Readonly<Record<string, Schema.Json>>,
	reference: { readonly url: string; readonly quote: string } | null
): ToolCalls[number] => ({
	id: 'restore',
	name: 'edit',
	input: {
		ops: [
			{
				path: `/snapshot/rule_set/${String(restored.code)}`,
				set: {
					...restored,
					references:
						reference === null
							? []
							: [
									{
										title: 'Official instrument fixture',
										url: reference.url,
										quote: reference.quote,
										locator: 's. 1',
										effective_from: '2026-10-10'
									}
								]
				}
			},
			cover('rules'),
			{ path: '/changed', set: true },
			{ path: '/summary', set: summary }
		]
	}
});
const submit: ToolCalls[number] = { id: 'save', name: 'submit', input: {} };

/** One `statutory_drift` run for `code` over a cassette of model turns; `page` is the cited page's fetched text. */
const research = (code: string, turns: readonly ToolCalls[], page = quote) =>
	Effect.gen(function* () {
		const seeded = lineage(code);
		const { url, rows } = seeded;
		const browserRequests: { name: string; input: Schema.Json }[] = [];
		const browserPages: string[] = [];
		const fetched: string[] = [];
		let openedUrl: string | undefined;
		const snapshot = (find?: string, from = 1) => {
			assert.ok(openedUrl, 'The browser fixture navigates before reading its page.');
			const lines = ['# Official instrument fixture', quote];
			const words = (find ?? '').toLowerCase().split(/\s+/).filter(Boolean);
			const shown = lines.flatMap((line, index) => {
				const number = index + 1;
				if (number < from) return [];
				if (words.length > 0 && !words.some((word) => line.toLowerCase().includes(word))) return [];
				return [words.length === 0 ? line : `${number}: ${line}`];
			});
			const result = Schema.decodeUnknownSync(BrowserPage)({
				url: openedUrl,
				title: 'Official instrument fixture',
				page: shown.join('\n'),
				lines: lines.length
			});
			browserPages.push(result.page);
			return Schema.decodeUnknownSync(Schema.Json)(result);
		};
		const hostTools: readonly HostTool[] = [
			{
				name: 'web_search',
				description: 'Search the web; this fixture expects no searches.',
				input: { type: 'object' },
				async call() {
					assert.fail('The fixture research reads the cited instrument without searching.');
				}
			}
		];
		// the host's browsing facility, behind Bolt's own browser tools
		const browser = Layer.succeed(Browser, {
			navigate: (_profile, to, find) =>
				Effect.sync(() => {
					browserRequests.push({
						name: 'browser_navigate',
						input: { ...to, ...(find === undefined ? {} : { find }) }
					});
					assert.ok('url' in to, 'The fixture has no browser history.');
					assert.equal(to.url, url, 'Only the cited official instrument may be opened.');
					openedUrl = to.url;
					return snapshot(find);
				}),
			snapshot: (_profile, options) =>
				Effect.sync(() => {
					browserRequests.push({ name: 'browser_snapshot', input: { ...options } });
					return snapshot(options.find, options.from);
				}),
			act: () =>
				Effect.sync(() =>
					assert.fail('The official instrument fixture expects no browser actions.')
				),
			evaluate: () =>
				Effect.sync(() => assert.fail('The official instrument fixture runs no scripts.')),
			screenshot: () =>
				Effect.sync(() => assert.fail('The official instrument fixture takes no screenshots.'))
		});
		const responses: AiResponse[] = turns.map((toolCalls) => ({
			content: '',
			toolCalls,
			finish: 'tool',
			usage: { input: 1, output: 1 }
		}));
		const context = yield* Layer.build(
			workspace({
				now: '2026-10-10T00:00:00Z',
				seed: { jurisdiction_settings: seeded.seededSettings, ...rows },
				fakes: { ai: { cassette: { strong: responses } } },
				host: { agent: { hostTools } },
				ports: Layer.merge(
					browser,
					Layer.succeed(WebRead, {
						read: (wanted) =>
							Effect.sync(() => {
								fetched.push(wanted);
								assert.equal(
									wanted,
									url,
									'Quote verification reads the cited official instrument.'
								);
								return { url: wanted, title: 'Official instrument fixture', text: page };
							})
					})
				)
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
			if (started.kind !== 'committed') assert.fail('The administrator starts the research run.');
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
			{ text: 'SELECT state, output, error FROM sys_run WHERE id = $1', params: [runId] }
		);
		assert.ok(completed);
		assert.equal(completed.state, 'succeeded', JSON.stringify(completed.error));
		const { rows: drafts } = yield* t.as(t.admin).read('jurisdiction_settings', {
			where: { cloned_from_id: { eq: nativeId('jurisdiction_settings', seeded.version.id) } },
			select: {
				id: true,
				sealed_at: true,
				cloned_from_id: true,
				suspension_kinds: true,
				sources: true,
				change_summary: true
			},
			all: true
		});
		return {
			...seeded,
			t,
			output: Schema.decodeUnknownSync(RunOutput)(completed.output),
			drafts,
			observed,
			fetched,
			browserRequests,
			browserPages,
			openedUrl
		};
	});

describe('statutory drift research transport (mock inference, not live research)', () => {
	for (const code of fs.readdirSync(root))
		it.effect(`${code}: one inference per coverage scope saves the complete corrected draft`, () =>
			Effect.gen(function* () {
				const { url, restored } = lineage(code);
				const result = yield* research(
					code,
					passes([
						{ id: 'navigate', name: 'browser_navigate', input: { url } },
						{ id: 'snapshot', name: 'browser_snapshot', input: {} },
						restore(restored, { url, quote }),
						{ id: 'diff', name: 'diff', input: {} },
						submit
					])
				);
				const { t, rows, missing, folder, version, settingsRows, source } = result;
				assert.deepEqual(result.output, {
					lineages: [code],
					drafted: [code],
					refused: [],
					failed: []
				});
				const ai = t.fakes.ai;
				assert.ok(ai);
				assert.equal(ai.requests.length, RESEARCH_AGENT_NAMES.length);
				assert.deepEqual(
					result.browserRequests.map((request) => request.name),
					['browser_navigate', 'browser_snapshot']
				);
				assert.equal(result.openedUrl, url);
				assert.deepEqual(result.browserPages, [
					`# Official instrument fixture\n${quote}`,
					`# Official instrument fixture\n${quote}`
				]);
				assert.deepEqual(result.fetched, [url]);
				const marker = 'Index of the snapshot sections you own (read original values in memory):\n';
				const request = ai.requests.find((item) =>
					item.messages.some(
						(message) =>
							typeof message.content === 'string' &&
							message.content.includes('You are the rules agent')
					)
				);
				assert.ok(request);
				assert.match(request.system ?? '', /Public holidays are out of scope/);
				const prompt = request.messages.find(
					(message) => typeof message.content === 'string' && message.content.includes(marker)
				);
				assert.ok(prompt);
				const content = Schema.decodeUnknownSync(Schema.String)(prompt.content);
				// The registry reaches the model as entry points only, never as an editable snapshot field; each agent sees
				// only its own sources.
				assert.ok(content.includes(source.url));
				assert.ok(!content.includes('"agent":"catalog"'));
				const index = Schema.decodeUnknownSync(Schema.fromJsonString(Index))(
					content.slice(content.indexOf(marker) + marker.length).split('\n', 1)[0]
				);
				// the rules agent indexes only what it owns: rule_set's VALIDATIONS and PAYROLL families
				assert.deepEqual(Object.keys(index.sections), ['rule_set']);
				const ruleIndex = Schema.decodeUnknownSync(RuleIndex)(index.sections['rule_set']).rows;
				const owned = rows.rule_set.filter((row) =>
					RULE_FAMILIES.rules.includes(String(row['family']))
				);
				assert.equal(ruleIndex.length, owned.length);
				assert.equal(
					ruleIndex.some((row) => row.code === missing['code']),
					false
				);
				for (const row of ruleIndex)
					assert.equal(
						row.path,
						`/snapshot/rule_set/${row.code.replaceAll('~', '~0').replaceAll('/', '~1')}`
					);
				const created = result.drafts[0];
				assert.ok(created);
				assert.equal(created.sealed_at, null);
				assert.equal(created.cloned_from_id, version.id);
				assert.equal(
					created.change_summary,
					`rule_set: added record_retention\n\nrules: ${summary}`
				);
				assert.deepEqual(created.sources, settingsRows[0]?.['sources']);
				assert.deepEqual(created.suspension_kinds, readSeedRows(folder, 'suspension_kind'));
				assert.equal('suspension_kind' in created, false);
				for (const name of tables) {
					assert.ok(result.observed.has(name), `The native body read ${name}.`);
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

	it.effect('a verified no-change resolves coverage and drafts nothing', () =>
		Effect.gen(function* () {
			const result = yield* research('SG', [...RESEARCH_AGENT_NAMES.map(idle)]);
			assert.deepEqual(result.output, { lineages: ['SG'], drafted: [], refused: [], failed: [] });
			assert.deepEqual(result.drafts, []);
			assert.deepEqual(result.fetched, []);
		})
	);

	it.effect(
		'a no-change left with pending coverage is reported incomplete, naming the scopes not resolved',
		() =>
			Effect.gen(function* () {
				const result = yield* research(
					'SG',
					RESEARCH_AGENT_NAMES.map(() => [submit])
				);
				assert.deepEqual(result.output.drafted, []);
				assert.equal(result.output.failed.length, 1);
				const [failed] = result.output.failed;
				assert.ok(failed);
				assert.ok(failed.startsWith('SG: incomplete — not resolved: '), failed);
				for (const agent of RESEARCH_AGENT_NAMES) assert.ok(failed.includes(agent), failed);
				assert.deepEqual(result.drafts, []);
			})
	);

	it.effect(
		"an agent whose inference fails keeps the other agents' verified rows and is named",
		() =>
			Effect.gen(function* () {
				const { url, restored } = lineage('SG');
				// the last agent to start (settings) finds no model turn left: its inference fails
				const result = yield* research(
					'SG',
					passes([restore(restored, { url, quote }), submit]).slice(0, -1)
				);
				assert.deepEqual(result.output.drafted, ['SG']);
				const created = result.drafts[0];
				assert.ok(created);
				assert.ok(
					created.change_summary?.startsWith(
						`rule_set: added record_retention\n\nrules: ${summary}\n\nNot resolved: settings (`
					),
					String(created.change_summary)
				);
			})
	);
	it.effect("an agent's edit to a row another agent owns is never merged", () =>
		Effect.gen(function* () {
			const { url, restored } = lineage('SG');
			// the catalog agent restores a PAYROLL rule: the rules agent's row, so nothing of it is taken
			const turns = RESEARCH_AGENT_NAMES.map((agent) =>
				agent === 'catalog' ? [restore(restored, { url, quote }), submit] : idle(agent)
			);
			const result = yield* research('SG', turns);
			assert.deepEqual(result.output.drafted, []);
			// nothing of its own changed, and its turn resolved another agent's coverage: incomplete, never a draft
			assert.deepEqual(result.output.refused, []);
			assert.deepEqual(result.output.failed, ['SG: incomplete — not resolved: catalog']);
			assert.deepEqual(result.drafts, []);
		})
	);
	it.effect('a row whose evidence fails is left out; the verified rows are still drafted', () =>
		Effect.gen(function* () {
			const { url, restored } = lineage('SG');
			const unlisted: ToolCalls[number] = {
				id: 'extra',
				name: 'edit',
				input: {
					ops: [
						{
							path: '/snapshot/rule_set/EXTRA_RULE',
							set: {
								...restored,
								code: 'EXTRA_RULE',
								references: [
									{
										title: 'Unofficial copy',
										url: 'https://example.invalid/law',
										quote,
										locator: 's. 1',
										effective_from: '2026-10-10'
									}
								]
							}
						}
					]
				}
			};
			const result = yield* Effect.scoped(
				research('SG', passes([restore(restored, { url, quote }), unlisted, submit]))
			);
			assert.deepEqual(result.output.drafted, ['SG']);
			assert.equal(result.output.refused.length, 1);
			assert.ok(
				result.output.refused[0]?.includes(
					'rule_set/EXTRA_RULE (cites unlisted https://example.invalid/law)'
				),
				String(result.output.refused[0])
			);
			const created = result.drafts[0];
			assert.ok(created);
			assert.equal(created.change_summary, `rule_set: added record_retention\n\nrules: ${summary}`);
		})
	);
	it.effect('an edit that cites nothing new is left out; the verified rows are still drafted', () =>
		Effect.gen(function* () {
			const { url, restored, rows } = lineage('SG');
			// a rule the rules agent owns: an edit elsewhere would never be merged at all
			const existing = rows.rule_set.find((row) =>
				RULE_FAMILIES.rules.includes(String(row['family']))
			);
			assert.ok(existing);
			const uncited: ToolCalls[number] = {
				id: 'uncited',
				name: 'edit',
				input: {
					ops: [
						{
							path: `/snapshot/rule_set/${String(existing['code'])}/name`,
							set: 'Renamed without evidence'
						}
					]
				}
			};
			const result = yield* research(
				'SG',
				passes([restore(restored, { url, quote }), uncited, submit])
			);
			assert.deepEqual(result.output.drafted, ['SG']);
			assert.ok(
				result.output.refused[0]?.includes(
					`rule_set/${String(existing['code'])} (cites no new url and quote)`
				),
				String(result.output.refused[0])
			);
			const created = result.drafts[0];
			assert.ok(created);
			assert.equal(created.change_summary, `rule_set: added record_retention\n\nrules: ${summary}`);
		})
	);
	it.effect('an unsupported change drafts nothing', () =>
		Effect.gen(function* () {
			const { url, restored } = lineage('SG');
			const cases = [
				{
					name: 'no reference',
					reference: null,
					page: quote,
					fetched: [],
					why: 'cites no new url and quote'
				},
				{
					name: 'quote not on its page',
					reference: { url, quote },
					page: 'An unrelated bulletin.',
					fetched: [url],
					why: `quote not found: "${quote.slice(0, 60)}" at ${url}`
				},
				{
					name: 'disallowed origin',
					reference: { url: 'https://example.invalid/law', quote },
					page: quote,
					fetched: [],
					why: 'cites unlisted https://example.invalid/law'
				}
			];
			for (const item of cases) {
				// Each run owns its workspace; only the gathered results leave the scope.
				const result = yield* Effect.scoped(
					research('SG', passes([restore(restored, item.reference), submit]), item.page)
				);
				const { refused, ...rest } = result.output;
				assert.deepEqual(rest, { lineages: ['SG'], drafted: [], failed: [] }, item.name);
				assert.equal(refused.length, 1, item.name);
				const [why] = refused;
				assert.ok(why?.startsWith('SG: ') && why.includes(item.why), String(why));
				assert.deepEqual(result.drafts, [], item.name);
				assert.deepEqual(result.fetched, item.fetched, item.name);
			}
		})
	);
});
