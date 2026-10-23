import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from '@effect/vitest';
import { datePeriod } from '@norbital-ai/std/date';
import { Schema } from 'effect';
import { readSeedRows } from './seed_values.ts';
import {
	completeSnapshot,
	conciseSnapshot,
	SNAPSHOT_MODELS,
	SNAPSHOT_OUTPUT,
	STATUTORY_RESEARCH_ROLE,
	type StatutorySnapshot
} from '../src/lib/payroll_engine/statutory_snapshot.ts';
import { allowedUrl, sourcesFrom } from '../src/lib/payroll_engine/statutory_drift.ts';
import { RESEARCH_AGENT_NAMES } from '../src/lib/payroll_engine/research_agents.ts';

const root = path.resolve(import.meta.dirname, '../seed/jurisdiction');
const diagnostics = Schema.decodeUnknownSync(
	Schema.fromJsonString(
		Schema.Struct({
			diagnostics: Schema.Array(
				Schema.Struct({
					missing_code: Schema.String,
					until: Schema.optionalKey(Schema.Json)
				})
			)
		})
	)
);
describe('complete statutory snapshots', () => {
	it("never shows research a version's bookkeeping to edit", () => {
		for (const field of [
			'change_summary',
			'sealed_at',
			'voided_at',
			'void_reason',
			'effective_range',
			'sources'
		])
			assert.equal(field in SNAPSHOT_MODELS.settings.fields, false, field);
		assert.equal('payroll' in SNAPSHOT_MODELS.settings.fields, true);
	});
	it('isolates nested seed values between snapshot reads', () => {
		const folder = path.join(root, 'SG', 'version_4');
		const [settings] = readSeedRows(folder, 'jurisdiction_settings');
		assert.ok(settings);
		const range = settings['effective_range'];
		assert.ok(range !== null && typeof range === 'object' && !Array.isArray(range));
		const original = structuredClone(range);
		Object.assign(range, { from: 'changed fixture only' });
		const [again] = readSeedRows(folder, 'jurisdiction_settings');
		assert.ok(again);
		assert.deepEqual(again['effective_range'], original);
		assert.notEqual(again['effective_range'], range);
	});
	it('flags the anonymisation dependency without supplying legal replacement data', () => {
		const missing = diagnostics(conciseSnapshot({ rule_set: [] })).diagnostics[0];
		assert.ok(missing);
		assert.equal(missing.missing_code, 'record_retention');
		assert.equal('until' in missing, false);
		assert.deepEqual(
			diagnostics(
				conciseSnapshot({
					rule_set: [
						{
							family: 'PAYROLL',
							code: 'record_retention',
							rules: { until: 'custom legal expression' }
						}
					]
				})
			).diagnostics,
			[]
		);
	});
	it("admits a registered official site's other hosts without permitting unrelated hosts", () => {
		const sources = sourcesFrom({
			entries: [
				{
					agent: 'contribution',
					url: 'https://www.bir.gov.ph/',
					instructions: 'Follow the public issuance library.'
				},
				{ agent: 'rules', url: 'https://congbao.chinhphu.vn/', instructions: 'The gazette.' },
				{ agent: 'rules', url: 'https://www.kyoukaikenpo.or.jp/', instructions: 'Kenpo.' }
			]
		});
		assert.equal(allowedUrl('https://bir-cdn.bir.gov.ph/issuance.pdf', sources), true);
		assert.equal(allowedUrl('https://www.dole.gov.ph/law', sources), true);
		assert.equal(allowedUrl('https://datafiles.chinhphu.vn/act.pdf', sources), true);
		assert.equal(
			allowedUrl('https://bir-cdn.bir.gov.ph.evil.invalid/issuance.pdf', sources),
			false
		);
		assert.equal(allowedUrl('https://www.mom.gov.sg/law', sources), false);
		assert.equal(allowedUrl('https://other.or.jp/law', sources), false);
	});
	it('preserves every section across all jurisdictions and supplies each agent its own sources and instructions', () => {
		for (const code of fs.readdirSync(root)) {
			const versions = fs.readdirSync(path.join(root, code)).filter((n) => /^version_\d+$/.test(n));
			let governing = 0;
			for (const version of versions) {
				const folder = path.join(root, code, version);
				const [settings] = readSeedRows(folder, 'jurisdiction_settings');
				assert.ok(settings);
				const sources = sourcesFrom(settings.sources);
				if (settings.voided_at == null) {
					const range = Schema.decodeUnknownSync(
						Schema.Struct({ from: Schema.String, to: Schema.NullOr(Schema.String) })
					)(settings.effective_range);
					if (range.from <= '2026-10-20' && (range.to == null || range.to >= '2026-10-20'))
						governing++;
				} else {
					assert.match(String(settings.voided_at), /^\d{4}-\d{2}-\d{2}T/);
					assert.ok(typeof settings.void_reason === 'string' && settings.void_reason.length > 20);
				}
				const entries = sources.entries;
				assert.ok(entries.length, `${code}/${version}`);
				// every agent has its own sources and supplementary instructions
				for (const agent of RESEARCH_AGENT_NAMES) {
					assert.ok(
						entries.some((entry) => entry.agent === agent),
						`${code}/${version}: ${agent} has no source`
					);
					assert.ok(sources.agents[agent], `${code}/${version}: ${agent} has no instructions`);
				}
				for (const entry of entries) {
					assert.ok(entry.instructions.length > 100);
					assert.equal(allowedUrl(new URL('/some-instrument', entry.url).href, sources), true);
					assert.equal(allowedUrl('https://example.invalid/law', sources), false);
					assert.ok(
						!/archive\.org|bakermckenzie|forvismazars|51shebao|drive\.google/.test(entry.url)
					);
				}
			}
			assert.equal(governing, 1, `${code} has one active snapshot governing 20 October 2026`);
		}
	});
	it('indexes all rows and settings paths while keeping long legal data in memory', () => {
		const repeated = 'Legal text '.repeat(300);
		const value = {
			settings: { code: 'test', reference_tables: { rates: [1, 2] } },
			rules: [
				{ code: 'first', references: [{ title: 'Act', quote: repeated }] },
				{ code: 'second/part', references: [{ title: 'Act', quote: repeated }] }
			],
			empty: []
		};
		const original = structuredClone(value);
		const concise = Schema.decodeUnknownSync(
			Schema.fromJsonString(
				Schema.Struct({
					sections: Schema.Struct({
						rules: Schema.Struct({
							count: Schema.Number,
							rows: Schema.Array(Schema.Struct({ code: Schema.String, path: Schema.String }))
						}),
						settings: Schema.Struct({
							fields: Schema.Struct({
								reference_tables: Schema.Struct({
									path: Schema.String,
									keys: Schema.Array(Schema.String)
								})
							})
						}),
						empty: Schema.Struct({ count: Schema.Number })
					})
				})
			)
		)(conciseSnapshot(value));
		assert.equal(concise.sections.rules.count, 2);
		assert.deepEqual(
			concise.sections.rules.rows.map((row) => [row.code, row.path]),
			[
				['first', '/snapshot/rules/first'],
				['second/part', '/snapshot/rules/second~1part']
			]
		);
		assert.equal(
			concise.sections.settings.fields.reference_tables.path,
			'/snapshot/settings/reference_tables'
		);
		assert.deepEqual(concise.sections.settings.fields.reference_tables.keys, ['rates']);
		assert.equal(concise.sections.empty.count, 0);
		assert.deepEqual(value, original);
		assert.ok(conciseSnapshot(value).length < JSON.stringify(value).length / 5);
	});
	it('refuses partial snapshots, duplicate row codes and switched lineage identity', () => {
		const before: StatutorySnapshot = {
			settings: {
				code: 'test',
				jurisdiction_code: 'test',
				name: 'Test',
				effective_range: datePeriod('2026-01-01', null),
				payroll: {}
			},
			adhoc_catalog: [],
			allowance_catalog: [],
			claim_catalog: [],
			leave_catalog: [],
			loan_catalog: [],
			work_catalog: [],
			statutory_contribution_catalog: [],
			suspension_kind: [],
			rule_set: [],
			behaviour_rule: []
		};
		const after = structuredClone(before);
		assert.equal(completeSnapshot(before, after), true);
		assert.equal(
			completeSnapshot(before, {
				...after,
				settings: { ...after.settings, voided_at: '2026-10-10T00:00:00Z' }
			}),
			false
		);
		assert.equal(completeSnapshot(before, { ...after, work_catalog: undefined }), false);
		assert.equal(
			completeSnapshot(before, { ...after, settings: { ...after.settings, code: 'other' } }),
			false
		);
		assert.equal(
			completeSnapshot(before, {
				...after,
				rule_set: [
					{ family: 'TASKS', code: 'same', name: 'One', rules: {} },
					{ family: 'TASKS', code: 'same', name: 'Two', rules: {} }
				]
			}),
			false
		);
	});
	it('keys every snapshot list by code, keeps the registry and quotes out, and keys coverage by scope', () => {
		const { snapshot } = SNAPSHOT_OUTPUT.fields;
		assert.equal('quotes' in SNAPSHOT_OUTPUT.fields, false);
		assert.equal('sources' in snapshot.fields.settings.fields, false);
		for (const [name, section] of Object.entries(snapshot.fields))
			if (name !== 'settings') assert.equal('key' in section && section.key, 'code', name);
		assert.equal(SNAPSHOT_OUTPUT.fields.coverage.key, 'scope');
		assert.deepEqual(RESEARCH_AGENT_NAMES, [
			'catalog',
			'contribution',
			'rules',
			'behaviour',
			'obligations',
			'settings'
		]);
	});
	it('guides keyed draft tools and row references, and keeps public holidays out of scope', () => {
		const role = STATUTORY_RESEARCH_ROLE;
		assert.match(role, /\/snapshot\/<section>\/<code>\/<field>/);
		for (const tool of ['edit', 'read', 'find', 'diff', 'submit', 'references', 'coverage'])
			assert.match(role, new RegExp(`\\b${tool}\\b`), tool);
		assert.doesNotMatch(role, /\bpatch\b|calendar|quotes/i);
		assert.deepEqual(role.match(/holiday/gi), ['holiday']);
		assert.match(role, /Public holidays are out of scope/);
	});
});
