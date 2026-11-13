// The statutory ledger materializes deterministically: cumulative, one snapshot per date, stale and conflicting refused.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { Refusal, stableJson } from '../../src/lib/payroll_engine/foundation.ts';
import {
	carries,
	instrumentKey,
	materialize,
	officialSource,
	SETTINGS_FAMILY,
	valueAt,
	WHOLE_ROW,
	type Snapshot,
	type StatutoryChange
} from '../../src/lib/payroll_engine/statutory_change.ts';
import {
	planChanges,
	referenceSources,
	sortFindings,
	type KnownChange,
	type ResearchVersion
} from '../../src/lib/payroll_engine/statutory_research.ts';
import { comparableVersion } from '../../src/lib/payroll_engine/version_compare.ts';

const baseline: Snapshot = {
	settings: {
		id: 'v1',
		code: 'MY',
		status: 'SEALED',
		effective_range: { from: '2026-01-01', to: null },
		lookup: { ceiling: 100 }
	},
	rows: {
		statutory_contribution_catalog: [
			{ id: 'b', code: 'EPF', employee_amount: 1, lookup: { ceiling: 12000000 } },
			{ id: 'a', code: 'SOCSO', employee_amount: 2 }
		],
		leave_catalog: [{ id: 'c', code: 'ANNUAL', days: 12 }]
	}
};
const change = (id: string, over: Partial<StatutoryChange>): StatutoryChange => ({
	id,
	jurisdiction_code: 'MY',
	family: 'statutory_contribution_catalog',
	row_code: 'EPF',
	field_path: 'lookup.ceiling',
	old_value: 12000000,
	new_value: 13000000,
	effective_from: '2027-01-01',
	status: 'CONFIRMED',
	applied_version_id: null,
	...over
});
const plan = (changes: readonly StatutoryChange[], target = '2030-01-01') =>
	materialize({ baseline, changes, target, jurisdiction: 'MY' });
const refused = (changes: readonly StatutoryChange[], reason: string) =>
	assert.throws(
		() => plan(changes),
		(error: unknown) => error instanceof Refusal && error.detail === reason
	);
const ceiling = {
	family: 'statutory_contribution_catalog',
	row_code: 'EPF',
	field_path: 'lookup.ceiling'
};

describe('statutory change materializer', () => {
	it('dates a snapshot on the change, never the research day, and leaves the baseline alone', () => {
		const [version, ...rest] = plan([change('1', {})]);
		assert.equal(rest.length, 0);
		assert.deepEqual(version?.snapshot.settings.effective_range, { from: '2027-01-01', to: null });
		assert.equal(valueAt(version?.snapshot ?? baseline, ceiling), 13000000);
		assert.equal(valueAt(baseline, ceiling), 12000000);
	});

	it('answers byte-identical plans whatever order the changes arrive in', () => {
		const changes = [
			change('2', { effective_from: '2027-06-01', old_value: 13000000, new_value: 14000000 }),
			change('1', {}),
			change('3', { row_code: 'SOCSO', field_path: 'employee_amount', old_value: 2, new_value: 3 })
		];
		assert.equal(stableJson(plan(changes)), stableJson(plan(changes.toReversed())));
		assert.deepEqual(
			plan(changes)[0]?.snapshot.rows.statutory_contribution_catalog?.map((row) => row.code),
			['EPF', 'SOCSO']
		);
	});

	it('makes one cumulative snapshot per effective date', () => {
		const versions = plan([
			change('1', {}),
			change('2', { field_path: 'employee_amount', old_value: 1, new_value: 2 }),
			change('3', {
				row_code: 'SOCSO',
				field_path: 'employee_amount',
				old_value: 2,
				new_value: 3,
				effective_from: '2027-06-01'
			})
		]);
		assert.deepEqual(
			versions.map((version) => [version.effective_from, version.change_ids]),
			[
				['2027-01-01', ['2', '1']],
				['2027-06-01', ['3']]
			]
		);
		const later = versions[1]?.snapshot ?? baseline;
		assert.equal(valueAt(later, ceiling), 13000000);
		assert.equal(valueAt(later, { ...ceiling, field_path: 'employee_amount' }), 2);
	});

	it('keeps undated, unconfirmed, applied and future changes out', () => {
		assert.equal(plan([change('1', { effective_from: null })]).length, 0);
		assert.equal(plan([change('1', { status: 'PROPOSED' })]).length, 0);
		assert.equal(plan([change('1', { applied_version_id: 'v2' })]).length, 0);
		assert.equal(plan([change('1', {})], '2026-12-31').length, 0);
	});

	it('refuses a stale change by name', () => {
		refused([change('1', { old_value: 11000000 })], 'stale');
		refused([change('1', { field_path: 'lookup.missing', old_value: 1 })], 'missing_path');
		refused([change('1', { row_code: 'NOPE' })], 'missing_row');
		refused([change('1', { effective_from: '2026-01-01' })], 'predates_baseline');
		refused(
			[change('1', { field_path: 'status', old_value: 'x', new_value: 'y' })],
			'protected_field'
		);
		refused([change('1', { field_path: '__proto__.x', old_value: null })], 'unsafe_path');
	});

	it('refuses two values for one date and path, and merges the same value twice', () => {
		refused([change('1', {}), change('2', { new_value: 15000000 })], 'conflict');
		assert.deepEqual(plan([change('1', {}), change('2', {})])[0]?.change_ids, ['1', '2']);
	});

	it('adds, removes and edits by exact declared paths', () => {
		const [version] = plan([
			change('1', { field_path: 'lookup.new_key', old_value: null, new_value: 5 }),
			change('2', { field_path: 'lookup.ceiling', new_value: null }),
			change('3', {
				family: 'leave_catalog',
				row_code: 'SICK',
				field_path: WHOLE_ROW,
				old_value: null,
				new_value: { days: 3 }
			}),
			change('4', {
				family: 'leave_catalog',
				row_code: 'ANNUAL',
				field_path: WHOLE_ROW,
				old_value: { code: 'ANNUAL', days: 12 },
				new_value: null
			}),
			change('5', {
				family: SETTINGS_FAMILY,
				row_code: null,
				field_path: 'lookup.ceiling',
				old_value: 100,
				new_value: 200
			})
		]);
		const snapshot = version?.snapshot ?? baseline;
		assert.equal(valueAt(snapshot, { ...ceiling, field_path: 'lookup.new_key' }), 5);
		assert.equal(valueAt(snapshot, ceiling), null);
		assert.deepEqual(
			snapshot.rows.leave_catalog?.map((row) => row.code),
			['SICK']
		);
		assert.deepEqual(snapshot.settings.lookup, { ceiling: 200 });
	});

	it('tells whether a written draft carries each change', () => {
		const one = change('1', {});
		assert.equal(carries(plan([one])[0]?.snapshot ?? baseline, one), true);
		assert.equal(carries(baseline, one), false);
	});

	it('recognises official hosts only over https', () => {
		for (const url of [
			'https://www.bpjs-kesehatan.go.id/a',
			'https://www.kwsp.gov.my/b',
			'https://www.cpf.gov.sg/c',
			'https://www.mhlw.go.jp/d',
			'https://www.irs.gov/e'
		])
			assert.equal(officialSource(url), true);
		for (const url of ['http://kwsp.gov.my/a', 'https://example.com', 'not a url'])
			assert.equal(officialSource(url), false);
	});
});

describe('statutory research planning', () => {
	const version = (id: string, from: string, to: string | null, rate: number): ResearchVersion => ({
		id,
		from,
		to,
		settings: { code: 'MY', lookup: {} },
		rows: [{ code: 'EPF', lookup: { rate } }],
		subtotals: [{ id: `${id}-basic`, code: 'BASIC' }]
	});
	const plan = (
		reported: Parameters<typeof planChanges>[0]['reported'],
		known: readonly KnownChange[] = [],
		versions = [version('v1', '2026-01-01', '2027-06-30', 1), version('v2', '2027-07-01', null, 3)]
	) =>
		planChanges({
			family: 'statutory_contribution_catalog',
			versions,
			known,
			reported,
			today: '2026-11-05'
		});
	const step = (new_value: number, effective_from: string | null) => ({
		row_code: 'EPF',
		field_path: 'lookup.rate',
		new_value,
		effective_from
	});
	const held = (new_value: number, effective_from: string | null, settled = false) => ({
		family: 'statutory_contribution_catalog',
		row_code: 'EPF',
		field_path: 'lookup.rate',
		new_value,
		effective_from,
		settled
	});

	it('reads old_value from the version the date lands on, never from today', () => {
		assert.equal(plan([step(2, '2026-12-01')]).planned[0]?.old_value, 1);
		const later = plan([step(4, '2027-08-01')]).planned[0];
		assert.equal(later?.old_value, 3);
		assert.equal(later?.baseline_version_id, 'v2');
	});

	it('keeps undated law undated', () => {
		assert.equal(plan([step(2, null)]).planned[0]?.effective_from, null);
		assert.equal(plan([step(2, 'next year')]).planned[0]?.effective_from, null);
	});

	it('drops what the lineage already holds, sealed for later included', () => {
		assert.equal(plan([step(1, '2026-12-01')]).planned.length, 0);
		assert.equal(plan([step(3, '2027-08-01')]).planned.length, 0);
		assert.equal(plan([step(3, null)]).planned.length, 0);
	});

	it('dedupes against the ledger in every state, by value and date', () => {
		assert.equal(plan([step(2, '2026-12-01')], [held(2, '2026-12-01')]).planned.length, 0);
		assert.equal(plan([step(2, '2026-12-01')], [held(2, '2026-12-01', true)]).planned.length, 0);
		assert.equal(plan([step(2, null)], [held(2, '2026-12-01')]).planned.length, 0);
		assert.equal(plan([step(2, '2026-12-15')], [held(2, '2026-12-01')]).planned.length, 1);
	});

	it('chains dated steps on a path, within one version only', () => {
		const { planned } = plan([step(5, '2027-03-01'), step(2, '2026-12-01')]);
		assert.deepEqual(
			planned.map((change) => change.old_value),
			[1, 2]
		);
		assert.equal(plan([step(4, '2027-01-01')], [held(2, '2026-12-01')]).planned[0]?.old_value, 2);
		assert.equal(
			plan([step(4, '2027-01-01')], [held(2, '2026-12-01', true)]).planned[0]?.old_value,
			1
		);
		assert.equal(plan([step(4, '2027-08-01')], [held(2, '2026-12-01')]).planned[0]?.old_value, 3);
	});

	it('binds a new row to its version by subtotal code', () => {
		const { planned } = plan([
			{
				row_code: 'NEW',
				field_path: WHOLE_ROW,
				new_value: { subtotal_id: 'BASIC', employer_cost_subtotal_id: 'ELSEWHERE' },
				effective_from: '2027-08-01'
			}
		]);
		assert.deepEqual(planned[0]?.new_value, {
			subtotal_id: 'v2-basic',
			employer_cost_subtotal_id: 'ELSEWHERE'
		});
	});

	it('skips a date no sealed version covers', () => {
		assert.equal(plan([step(2, '2025-01-01')]).skipped.length, 1);
	});

	it('keys an instrument however it is spelled', () => {
		assert.equal(instrumentKey('Act No. 452/1991'), instrumentKey('act no 452 1991'));
		assert.equal(instrumentKey('労働基準法 第32条'), '労働基準法-第32条');
	});

	it('merges repeats, keeps decisions and flags what no family holds', () => {
		const reported = {
			instrument: 'Act 1/2027',
			title: 'T',
			fit: 'VALUE' as const,
			families: ['leave_catalog'],
			source_urls: ['https://a.gov.my/1']
		};
		const fresh = sortFindings(
			[reported, { ...reported, instrument: 'act 1 2027', families: ['claim_catalog'] }],
			[]
		).fresh;
		assert.equal(fresh.length, 1);
		assert.deepEqual(fresh[0]?.families, ['leave_catalog', 'claim_catalog']);
		assert.equal(
			sortFindings([{ ...reported, families: ['visa'] }], []).fresh[0]?.fit,
			'STRUCTURAL'
		);
		const on_file = {
			id: 'f1',
			instrument_key: 'act-1-2027',
			status: 'PROPOSED',
			source_urls: ['https://b.gov.my/2']
		};
		assert.deepEqual(sortFindings([reported], [on_file]).merged, [
			['f1', ['https://b.gov.my/2', 'https://a.gov.my/1']]
		]);
		for (const status of ['REJECTED', 'CONFIRMED', 'APPLIED'])
			assert.deepEqual(sortFindings([reported], [{ ...on_file, status }]), {
				fresh: [],
				merged: [],
				decided: ['act-1-2027']
			});
	});

	it('opens sources from citations: official hosts active, others for a person', () => {
		const rows = [
			{ references: [{ title: 'A', url: 'https://www.cpf.gov.sg/a' }, { title: 'B' }] },
			{ references: [{ title: 'C', url: 'https://www.cpf.gov.sg/c' }] },
			{ references: [{ title: 'D', url: 'https://vanban.chinhphu.vn/d' }] },
			{ references: [{ title: 'E', url: 'https://web.archive.org/e' }] },
			{ references: [{ title: 'F', url: 'https://www.mom.gov.sg/f' }] }
		];
		assert.deepEqual(
			referenceSources(rows, ['https://www.mom.gov.sg']).map((row) => [row.url, row.status]),
			[
				['https://www.cpf.gov.sg', 'ACTIVE'],
				['https://vanban.chinhphu.vn', 'PROPOSED']
			]
		);
	});
});

describe('version comparison', () => {
	const versionOf = (id: string, ceiling: number) =>
		comparableVersion(
			{ id, code: 'MY', revision: 3, name: id, lookup: {} },
			{
				subtotal: [
					{ id: `${id}-b`, code: 'BASIC', settings_id: id, previous_id: null },
					{ id: `${id}-g`, code: 'GROSS', settings_id: id, previous_id: `${id}-b` }
				],
				statutory_contribution_catalog: [
					{ id: `${id}-z`, code: 'Z', settings_id: id, subtotal_id: `${id}-g`, ceiling },
					{ id: `${id}-a`, code: 'A', settings_id: id, subtotal_id: `${id}-b`, ceiling: 1 }
				]
			}
		);

	it('leaves only what the law says: ids, audit and bindings differ by version, not by law', () => {
		const left = versionOf('v1', 10),
			right = versionOf('v2', 10);
		assert.deepEqual(left.subtotal, right.subtotal);
		assert.deepEqual(left.statutory_contribution_catalog, right.statutory_contribution_catalog);
	});

	it('shows a change, keys rows by code and reads subtotal links by code', () => {
		const left = versionOf('v1', 10),
			right = versionOf('v2', 20);
		assert.notDeepEqual(left.statutory_contribution_catalog, right.statutory_contribution_catalog);
		assert.deepEqual(left.statutory_contribution_catalog, {
			A: { code: 'A', subtotal_id: 'BASIC', ceiling: 1 },
			Z: { code: 'Z', subtotal_id: 'GROSS', ceiling: 10 }
		});
	});
});
