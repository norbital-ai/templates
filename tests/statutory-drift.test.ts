// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The statutory drift automation over a fake run ctx: every lineage researches at once, each call
 * carries its tools, sources and version rows, changes become one unsealed draft, and one failing
 * lineage never stops another.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import statutoryDrift from '../src/automation/+statutory_drift.automation.ts';
import { STATUTORY_SOURCES } from '../src/lib/statutory_sources.ts';
import { LINEAGES, settingsVersions } from './fixtures/statutory-world.ts';

const version = (code: string) => ({
	id: `v-${code}`,
	code,
	name: code,
	jurisdiction_code: code,
	sealed_at: '2026-01-01T00:00:00.000Z',
	voided_at: null,
	approval_id: null,
	effective_range: { from: '2026-01-01', to: null },
	sources: { urls: [] }
});
const scheme = (code: string) => ({
	id: `s-${code}`,
	settings_id: `v-${code}`,
	code: 'FUND',
	rules: [{ when: 'base >= 0.0', employee: '11.0', employer: '13.0' }]
});
const change = (code: string) => ({
	collection: 'statutory_contributions',
	row: `s-${code}`,
	field: 'rules',
	from: scheme(code).rules,
	to: [{ when: 'base >= 0.0', employee: '12.0', employer: '13.0' }],
	effective_from: '2027-01-01',
	source_url: 'https://official.example/rates',
	quote: 'the employee rate is 12%'
});

/** Runs the automation; `answer(code)` is each lineage's research reply (a thrown error fails that lineage). */
async function run(codes: string[], answer: (code: string) => unknown) {
	const versions = codes.map(version);
	const calls = [];
	const writes = [];
	const pending = [];
	const ctx = {
		today: '2026-09-01',
		progress: async () => {},
		get: async (_collection, id) => versions.find((row) => row.id === id) ?? null,
		// a read answers only the fields it selects and the id, as the engine does
		read: async (collection, query) => ({
			rows: (collection === 'jurisdiction_settings'
				? versions
				: collection === 'statutory_contributions'
					? codes.map(scheme).filter((row) => row.settings_id === query.where.settings_id.eq)
					: []
			).map((row) =>
				query.select === undefined
					? row
					: Object.fromEntries(Object.entries(row).filter(([k]) => k === 'id' || k in query.select))
			),
			next: null
		}),
		ai: {
			sys_2: {
				// every call stays open until all lineages have called: a sequential run never gets its first answer
				infer: {
					try: (request) =>
						new Promise((resolve, reject) => {
							const code = codes.find((c) => request.system.includes(`lineage ${c}.`));
							calls.push({ code, request });
							pending.push(() => {
								try {
									resolve(answer(code));
								} catch (error) {
									reject(error);
								}
							});
							if (pending.length === codes.length) for (const settle of pending) settle();
						})
				}
			}
		},
		act: async (callable, write) => {
			writes.push([callable, write]);
			return { records: [{ collection: 'jurisdiction_settings', id: `draft-${write.code}` }] };
		}
	};
	const result = await statutoryDrift.body({}, ctx);
	return { result, calls, writes };
}

test(
	'every lineage researches in parallel, with the browser, its sources and its version rows',
	{ timeout: 2000 },
	async () => {
		const { calls } = await run(['MY', 'SG'], () => ({ changes: [] }));
		assert.equal(calls.length, 2);
		for (const { code, request } of calls) {
			assert.deepEqual(request.tools, ['browser_navigate', 'browser_snapshot', 'browser_act']);
			assert.equal(request.model, 'strong');
			assert.ok(
				request.system.includes(JSON.stringify(STATUTORY_SOURCES[code])),
				`${code} sources`
			);
			const rows = JSON.parse(request.prompt.slice(request.prompt.indexOf('{')));
			assert.equal(rows.jurisdiction_settings[0].id, `v-${code}`);
			assert.deepEqual(rows.statutory_contributions[0].rules, scheme(code).rules);
		}
	}
);

test('every seeded jurisdiction has official sources to research', () => {
	for (const lineage of LINEAGES)
		for (const { jurisdiction_code } of settingsVersions(lineage))
			assert.ok(
				STATUTORY_SOURCES[jurisdiction_code]?.length,
				`${lineage}: no sources for ${jurisdiction_code}`
			);
});

test('changes become one unsealed draft; no changes, no draft', { timeout: 2000 }, async () => {
	const { result, writes } = await run(['MY', 'SG'], (code) => ({
		changes: code === 'MY' ? [change('MY')] : [],
		notes: null
	}));
	assert.deepEqual(
		result.lineages.map((row) => [row.code, row.status, row.draft_id ?? null, row.changes]),
		[
			['MY', 'proposed', 'draft-MY', 1],
			['SG', 'no_changes_detected', null, 0]
		]
	);
	assert.equal(writes.length, 1);
	const [[callable, write]] = writes;
	assert.equal(callable, 'jurisdiction_settings.create');
	assert.equal(write.sealed_at, null);
	assert.deepEqual(write.effective_range, { from: '2027-01-01', to: null });
	assert.deepEqual(write.statutory_contributions.create[0].rules, change('MY').to);
});

test(
	'a change may name its row by its code where one row of the collection carries it',
	{ timeout: 2000 },
	async () => {
		const { result, writes } = await run(['MY'], () => ({
			changes: [{ ...change('MY'), row: 'FUND' }],
			notes: null
		}));
		assert.deepEqual(
			result.lineages.map((row) => [row.status, row.changes]),
			[['proposed', 1]]
		);
		assert.deepEqual(writes[0][1].statutory_contributions.create[0].rules, change('MY').to);
	}
);

test('one lineage failing does not stop the others', { timeout: 2000 }, async () => {
	const { result, writes } = await run(['MY', 'SG'], (code) => {
		if (code === 'MY') throw new Error('model unavailable');
		return { changes: [change('SG')] };
	});
	assert.deepEqual(
		result.lineages.map((row) => [row.code, row.status]),
		[
			['MY', 'failed'],
			['SG', 'proposed']
		]
	);
	assert.deepEqual(result.failures, ['MY: model unavailable']);
	assert.equal(writes.length, 1);
});
