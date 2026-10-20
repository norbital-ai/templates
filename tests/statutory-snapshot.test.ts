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
	supportedSnapshotChanges,
	type StatutorySnapshot
} from '../src/lib/payroll_engine/statutory_snapshot.ts';
import { allowedUrl, sourcesFrom } from '../src/lib/payroll_engine/statutory_drift.ts';

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
	it('permits explicitly registered official document origins without permitting unrelated hosts', () => {
		const sources = sourcesFrom({
			entries: [
				{
					url: 'https://www.bir.gov.ph/',
					instructions: 'Follow the public issuance library.',
					document_origins: ['https://bir-cdn.bir.gov.ph/']
				}
			]
		});
		assert.equal(allowedUrl('https://bir-cdn.bir.gov.ph/issuance.pdf', sources), true);
		assert.equal(
			allowedUrl('https://bir-cdn.bir.gov.ph.evil.invalid/issuance.pdf', sources),
			false
		);
		assert.equal(allowedUrl('https://unlisted.bir.gov.ph/issuance.pdf', sources), false);
	});
	it('preserves every section across all jurisdictions and supplies per-source portal instructions', () => {
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
				assert.ok(entries?.length, `${code}/${version}`);
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
				{ code: 'first', authority: repeated },
				{ code: 'second', authority: repeated }
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
				['first', '/snapshot/rules/0'],
				['second', '/snapshot/rules/1']
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
	it('refuses partial snapshots, switched lineage/source registries and corrections without precise evidence', () => {
		const before: StatutorySnapshot = {
			settings: {
				code: 'test',
				jurisdiction_code: 'test',
				name: 'Test',
				effective_range: datePeriod('2026-01-01', null),
				payroll: {},
				sources: { entries: [{ url: 'https://www.mom.gov.sg/', instructions: 'Official source' }] }
			},
			adhoc_catalog: [],
			allowance_catalog: [],
			claim_catalog: [],
			leave_catalog: [],
			loan_catalog: [],
			work_catalog: [],
			statutory_contribution_catalog: [],
			suspension_kind: [],
			rule_set: []
		};
		const copy = structuredClone(before);
		assert.equal(completeSnapshot(before, copy), true);
		const after = {
			...copy,
			settings: {
				...copy.settings,
				sources: {
					entries: [{ instructions: 'Official source', url: 'https://www.mom.gov.sg/' }]
				}
			}
		};
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
				settings: { ...after.settings, sources: { entries: [{ url: 'https://evil.invalid/' }] } }
			}),
			false
		);
		const restored = { ...after, rule_set: [{ code: 'restored', rules: { due: 'period.to' } }] };
		assert.equal(supportedSnapshotChanges(before, restored, []), false);
		assert.equal(supportedSnapshotChanges(before, restored, [{ paths: ['/snapshot'] }]), false);
		assert.equal(
			supportedSnapshotChanges(before, restored, [{ paths: ['/snapshot/rule_set/0'] }]),
			true
		);
		assert.equal(
			supportedSnapshotChanges(before, before, [{ paths: ['/snapshot/rule_set/0'] }]),
			false
		);
	});
});
