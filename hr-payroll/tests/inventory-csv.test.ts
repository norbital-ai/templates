/**
 * The jurisdiction trackers follow the contract in docs/inventory/README.md: fixed headers,
 * unique ids, closed status vocabulary, and every golden or probe a row names actually exists.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { parseCsv } from './helpers/csv.ts';

const HEADERS = [
	'id',
	'profile',
	'area',
	'provision',
	'citation',
	'url',
	'source_checked',
	'effective_from',
	'effective_to',
	'status',
	'reason',
	'config_path',
	'golden',
	'probe',
	'verified_at'
];
const AREAS = new Set([
	'wages',
	'minimum_wage',
	'hours',
	'overtime',
	'rest_holiday',
	'leave',
	'proration',
	'contribution',
	'tax',
	'rounding',
	'severance',
	'notice',
	'final_pay',
	'bonus',
	'levy',
	'filing',
	'records',
	'other'
]);
const STATUSES = new Set([
	'VERIFIED',
	'TESTED',
	'IMPLEMENTED',
	'PARTIAL',
	'GAP',
	'EXTERNAL',
	'EXTERNAL-RECORDED',
	'AWAITING-LAW',
	'SOURCE-BLOCKED',
	'NOT-APPLICABLE'
]);

test('the CSV parser keeps quoted commas, newlines and quotes', () => {
	const rows = parseCsv('a,b\r\n"x, y","line\none ""q"""\nz\n');
	assert.deepEqual([...rows], [['a', 'b'], ['x, y', 'line\none "q"'], ['z']]);
	assert.deepEqual(rows.lines, [1, 2, 4]);
});

const dir = new URL('../docs/inventory/', import.meta.url);
const trackers = readdirSync(dir).filter((f) => f.endsWith('.csv'));

const sources = (d: URL, match: (f: string) => boolean) =>
	readdirSync(d)
		.filter(match)
		.map((f) => readFileSync(new URL(f, d), 'utf8'))
		.join('\n');
const testTitles = new Set(
	[
		...sources(new URL('./', import.meta.url), (f) => f.endsWith('.test.ts')).matchAll(
			/\btest\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
		)
	].map((m) => m[2].replace(/\\(.)/g, '$1'))
);
const probeDir = new URL('./e2e/probes/', import.meta.url);
const probeFiles = readdirSync(probeDir).filter((f) => f.endsWith('.ts'));
const probeSource = sources(probeDir, (f) => probeFiles.includes(f));
// a case registered per row of a table names its id as a template: `JP-REGION-${jis}-1`
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const probeTemplates = [...probeSource.matchAll(/`([\w.-]*)\$\{[^}`]+\}([\w.-]*)`/g)]
	.filter((m) => m[1] !== '')
	.map((m) => new RegExp(`^${escape(m[1])}[\\w.]+${escape(m[2])}$`));
const hasProbe = (id: string) =>
	["'", '"', '`'].some((q) => probeSource.includes(q + id + q)) ||
	probeTemplates.some((template) => template.test(id));

/** `golden` is one test title or several joined by `; ` (a title may itself hold `; `). */
const goldensNamed = (golden: string): boolean =>
	testTitles.has(golden) ||
	golden
		.split('; ')
		.some(
			(_, cut, parts) =>
				cut > 0 &&
				testTitles.has(parts.slice(0, cut).join('; ')) &&
				goldensNamed(parts.slice(cut).join('; '))
		);

test('every jurisdiction tracker keeps the inventory contract', () => {
	const ids = new Map<string, string>();
	for (const file of trackers) {
		const [header, ...rows] = parseCsv(readFileSync(new URL(file, dir), 'utf8'));
		assert.deepEqual(header, HEADERS, `${file}: headers`);
		for (const [n, cells] of rows.entries()) {
			const at = `${file}:${n + 2}`;
			assert.equal(cells.length, HEADERS.length, `${at}: column count`);
			const row = Object.fromEntries(HEADERS.map((h, i) => [h, cells[i].trim()]));
			assert.ok(row.id, `${at}: id`);
			assert.ok(!ids.has(row.id), `${at}: id ${row.id} already in ${ids.get(row.id)}`);
			ids.set(row.id, at);
			assert.ok(AREAS.has(row.area), `${at}: area ${row.area}`);
			assert.ok(STATUSES.has(row.status), `${at}: status ${row.status}`);
			if (row.status !== 'VERIFIED' && row.status !== 'NOT-APPLICABLE')
				assert.ok(row.reason, `${at}: ${row.status} needs a reason`);
			if (row.status !== 'SOURCE-BLOCKED') assert.ok(row.url, `${at}: url`);
			if (row.status === 'VERIFIED')
				assert.ok(row.probe && row.verified_at, `${at}: VERIFIED needs probe and verified_at`);
			if (row.status === 'TESTED') assert.ok(row.golden, `${at}: TESTED needs a golden`);
			if (row.golden) assert.ok(goldensNamed(row.golden), `${at}: no test titled ${row.golden}`);
			if (row.probe && probeFiles.length)
				for (const id of row.probe.split(/\s*;\s*/))
					assert.ok(hasProbe(id), `${at}: no probe case ${id}`);
		}
	}
});
